import { getAiChatSidebarActivityAt } from './visibility';
import type { MessagesQueryResponse } from '../../chat/core/types';
import { internalAction } from '../_generated/server';
import { v } from 'convex/values';
import { internal } from '../_generated/api';
import { aiChatAgent } from './agent';
import { paginationOptsValidator } from 'convex/server';
import { abortStream, getFile, saveMessages } from '@convex-dev/agent';
import { vStreamArgs } from '@convex-dev/agent/validators';
import { components } from '../_generated/api';
import type { UserContent } from 'ai';
import { aiChatRateLimiter } from './rateLimit';
import { listMessagesForThread } from '../support/messageListing';
import { authedMutation, authedQuery } from '../functions';
import { getFileMetadataByUrls } from '../files/metadata';
import { checkAndCountUsage, refundUsage } from '../autumn';
import { requireAiChatThreadRecord } from './ownership';
import { createRateLimitError } from '../support/types';
import { AI_CHAT_ERROR_CODES, createAiChatError } from './errors';
import {
	AI_CHAT_GENERATION_FAILED_NOTICE,
	AI_CHAT_LIMIT_NOTICE,
	MAX_MESSAGE_LENGTH,
	type AiChatNotice
} from '../constants';
import { STREAM_DELTA_OPTIONS } from '../streamDeltas';
import { makeAgentUsageSink } from '../aiUsage/agentUsage';
import { ensureCaptureStart } from '../admin/journey/capture';
import { recordAiUsage } from '../aiUsage/record';
import {
	CapabilityConfigurationError,
	requireAiConfiguration,
	requireBillingConfiguration
} from '../env';
import {
	prepareToolErrorRedactionStep,
	toolErrorRedactionTransform
} from '../../chat/core/tool-error-redaction';

const THREAD_PREVIEW_LENGTH = 100;

/**
 * Send a user message and get AI response with streaming.
 *
 * Billing is counted inside `createAIResponse` via `checkAndCountUsage`
 * (featureId `ai_chat_messages`) and refunded with `refundUsage` when the
 * generation fails. It is not a separate action the frontend calls. Kept as a mutation for optimistic update support.
 *
 * Returns the saved prompt's id and the `order` the agent assigned it. The
 * reply, or the notice that replaces it, lands at that same order.
 */
export const sendMessage = authedMutation({
	args: {
		threadId: v.string(),
		prompt: v.string(),
		fileIds: v.optional(v.array(v.string()))
	},
	returns: v.object({ messageId: v.string(), order: v.number() }),
	handler: async (ctx, args) => {
		if (args.prompt.length > MAX_MESSAGE_LENGTH) {
			throw createAiChatError(AI_CHAT_ERROR_CODES.messageTooLong, {
				maxLength: MAX_MESSAGE_LENGTH
			});
		}

		const userId = ctx.user._id;

		// Verify thread ownership
		const record = await requireAiChatThreadRecord(ctx, {
			threadId: args.threadId,
			userId
		});

		requireBillingConfiguration();
		requireAiConfiguration();

		// First send in this thread → derive a descriptive title from it. Uses
		// lastMessageAt (written on every send, never an empty string) rather than
		// lastMessage, which can be '' for a file-only first message and would
		// misidentify later sends as the first. Captured before the patch below.
		const isFirstMessage = record.lastMessageAt === undefined;

		// Consume warm thread on first message (backend-driven, no client coordination needed)
		if (record.isWarm) {
			await ctx.db.patch('aiChatThreads', record._id, {
				isWarm: false,
				sidebarActivityAt: getAiChatSidebarActivityAt({ ...record, isWarm: false })
			});
		}

		// Rate limit check
		const rateLimitStatus = await aiChatRateLimiter.limit(ctx, 'aiChatMessage', { key: userId });
		if (!rateLimitStatus.ok) {
			throw createRateLimitError(rateLimitStatus.retryAfter);
		}

		let saved: Awaited<ReturnType<typeof aiChatAgent.saveMessage>>;

		// Build and save message (multimodal or text-only)
		if (args.fileIds && args.fileIds.length > 0) {
			const content: UserContent = [];

			if (args.prompt.trim()) {
				content.push({ type: 'text', text: args.prompt });
			}

			for (const fileId of args.fileIds) {
				const { filePart } = await getFile(ctx, components.agent, fileId);
				content.push(filePart);
			}

			saved = await aiChatAgent.saveMessage(ctx, {
				threadId: args.threadId,
				message: { role: 'user', content },
				metadata: { fileIds: args.fileIds },
				skipEmbeddings: true
			});
		} else {
			saved = await aiChatAgent.saveMessage(ctx, {
				threadId: args.threadId,
				prompt: args.prompt,
				skipEmbeddings: true
			});
		}
		const { messageId } = saved;

		// One receipt per saved user message, in this transaction, so a rejected
		// or rolled-back send leaves none and a failed AI reply keeps it.
		await ctx.db.insert('aiChatMessageReceipts', { userId });
		await ensureCaptureStart(ctx, 'aiChat');

		// Denormalize for the sidebar. lastMessageAt is the "thread has been used"
		// signal (drives visibility + first-send); lastMessage is a display-only
		// preview, so skip it for a file-only send rather than persisting ''.
		const preview = args.prompt.trim().slice(0, THREAD_PREVIEW_LENGTH);
		const lastMessageAt = Date.now();
		await ctx.db.patch('aiChatThreads', record._id, {
			...(preview ? { lastMessage: preview } : {}),
			lastMessageAt,
			sidebarActivityAt: getAiChatSidebarActivityAt({ ...record, isWarm: false, lastMessageAt })
		});

		// Schedule AI response
		await ctx.scheduler.runAfter(0, internal.aiChat.messages.createAIResponse, {
			threadId: args.threadId,
			promptMessageId: messageId,
			userId
		});

		// Generate a descriptive thread title from the first user message (LLM,
		// fire-and-forget). Skipped for file-only first messages with no text.
		if (isFirstMessage && args.prompt.trim().length > 0) {
			await ctx.scheduler.runAfter(0, internal.aiChat.titles.generateThreadTitle, {
				threadId: args.threadId,
				prompt: args.prompt,
				userId
			});
		}

		return { messageId, order: saved.message.order };
	}
});

/**
 * Internal action to generate AI response with streaming.
 *
 * Counts the AI chat message in one atomic Autumn call before
 * generating (see `checkAndCountUsage` for the concurrency semantics;
 * a separate check-before plus track-after pair would let concurrent
 * sends race past the limit during the multi-second stream). If
 * generation fails after the unit was counted, the unit is refunded
 * once so a failed response never costs a message, and a terminal
 * notice resolves the turn. A failure of the sidebar metadata write or
 * of usage recording after delivery neither refunds nor adds a notice.
 */
export const createAIResponse = internalAction({
	args: {
		threadId: v.string(),
		promptMessageId: v.string(),
		userId: v.optional(v.string())
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		// Ends the prompt's turn with an assistant notice. `promptMessageId`
		// makes the agent save it at the prompt's order, after that turn's
		// steps, with the prompt as parent; without it the agent appends at the
		// thread's latest order, which belongs to a later prompt once the user
		// has sent another message. When a failed generation leaves the agent's
		// reply row pending or its stream live, the listing would overlay that
		// stream on the notice and the composer would stay busy, so
		// `failPendingSteps` fails pending rows and `abortStream` stops streams,
		// both only at this prompt's order.
		const saveTerminalNotice = async ({
			content,
			notice
		}: {
			content: string;
			notice?: AiChatNotice;
		}) => {
			const { messages } = await saveMessages(ctx, components.agent, {
				threadId: args.threadId,
				userId: args.userId,
				promptMessageId: args.promptMessageId,
				failPendingSteps: true,
				messages: [{ role: 'assistant', content }],
				...(notice
					? { metadata: [{ provider: 'system', providerMetadata: { system: { notice } } }] }
					: {})
			});
			const [saved] = messages;
			if (saved) {
				await abortStream(ctx, components.agent, {
					threadId: args.threadId,
					order: saved.order,
					reason: 'AI chat reply failed'
				});
			}
		};

		try {
			requireBillingConfiguration();
			requireAiConfiguration();
		} catch (error) {
			if (!(error instanceof CapabilityConfigurationError)) throw error;
			await saveTerminalNotice({
				content: "This reply couldn't be generated because AI is unavailable."
			});
			return null;
		}

		// Direct SDK path with explicit customer_id (no auth context in
		// internalAction). See: https://github.com/useautumn/autumn-js/issues/51
		let usageCounted = false;
		if (args.userId) {
			const outcome = await checkAndCountUsage({
				customerId: args.userId,
				featureId: 'ai_chat_messages'
			});
			if (outcome === 'denied') {
				console.warn(`[createAIResponse] AI chat limit reached for user ${args.userId}`);
				// Returning without an assistant message strands the client in its
				// awaiting-stream state. Persist a terminal notice so the turn resolves;
				// providerMetadata lets the UI replace this fallback with localized copy.
				await saveTerminalNotice({
					content: "You've reached your message limit, so this reply couldn't be generated.",
					notice: AI_CHAT_LIMIT_NOTICE
				});
				return null;
			}
			// 'unavailable' fails open: generate uncounted rather than blocking
			// a legitimate user on a billing outage
			usageCounted = outcome === 'counted';
		}

		try {
			requireAiConfiguration();
		} catch (error) {
			if (!(error instanceof CapabilityConfigurationError)) throw error;
			if (args.userId && usageCounted) {
				await refundUsage({ customerId: args.userId, featureId: 'ai_chat_messages' });
			}
			await saveTerminalNotice({
				content: "This reply couldn't be generated because AI is unavailable."
			});
			return null;
		}

		const sink = makeAgentUsageSink();
		// The AI SDK turns a provider failure into an error part of the stream:
		// `consumeStream` still resolves, and `text` resolves from the last
		// finished step when an earlier tool step succeeded. `onError` sees
		// every such part, so it decides the outcome together with a rejection.
		let streamFailure: { error: unknown } | undefined;
		let failure: { error: unknown } | undefined;
		let responseText = '';
		try {
			const result = await aiChatAgent.streamText(
				ctx,
				{ threadId: args.threadId, userId: args.userId },
				{
					promptMessageId: args.promptMessageId,
					prepareStep: prepareToolErrorRedactionStep,
					experimental_transform: toolErrorRedactionTransform,
					onError: ({ error }) => {
						streamFailure ??= { error };
					}
				},
				{
					saveStreamDeltas: STREAM_DELTA_OPTIONS,
					usageHandler: sink.usageHandler
				}
			);

			await result.consumeStream();
			failure = streamFailure;
			// `text` rejects when no step finished or the stream was aborted.
			if (!failure) responseText = await result.text;
		} catch (error) {
			failure = { error };
		}

		if (failure) {
			// The unit was counted up front; a failed generation must not cost
			// a message. The refund window ends here: once the reply is
			// delivered, later denormalization errors don't refund it.
			if (args.userId && usageCounted) {
				await refundUsage({ customerId: args.userId, featureId: 'ai_chat_messages' });
			}
			// Record any usage the model already produced before the failure so a
			// failed turn is still attributed (status: error), not silently dropped.
			await recordAiUsage(ctx, {
				feature: 'ai_chat',
				userId: args.userId,
				threadId: args.threadId,
				status: 'error',
				models: sink.collect()
			});
			await saveTerminalNotice({
				content: "This reply couldn't be generated.",
				notice: AI_CHAT_GENERATION_FAILED_NOTICE
			});
			throw failure.error;
		}

		await recordAiUsage(ctx, {
			feature: 'ai_chat',
			userId: args.userId,
			threadId: args.threadId,
			status: 'ok',
			models: sink.collect()
		});

		// Denormalize: update thread sidebar metadata with the AI's response.
		// Trim and skip an empty preview so a whitespace-only response never lands
		// as the sidebar label (mirrors the user-message path in sendMessage).
		const responsePreview = responseText.trim().slice(0, THREAD_PREVIEW_LENGTH);
		if (responsePreview) {
			await ctx.runMutation(internal.aiChat.threads.updateThreadMetadata, {
				threadId: args.threadId,
				lastMessage: responsePreview,
				lastMessageAt: Date.now()
			});
		}
		return null;
	}
});

/**
 * List messages in a thread with streaming support
 */
export const listMessages = authedQuery({
	args: {
		threadId: v.string(),
		paginationOpts: paginationOptsValidator,
		streamArgs: vStreamArgs
	},
	// v.any(): paginated message + stream shape is owned by @convex-dev/agent
	returns: v.any(),
	handler: async (ctx, args): Promise<MessagesQueryResponse> => {
		// Verify ownership
		await requireAiChatThreadRecord(ctx, {
			threadId: args.threadId,
			userId: ctx.user._id
		});

		return await listMessagesForThread(ctx, {
			threadId: args.threadId,
			paginationOpts: args.paginationOpts,
			streamArgs: args.streamArgs
		});
	}
});

/**
 * Get file metadata (dimensions) for multiple files by URL
 *
 * Authenticated because AI chat attachment metadata belongs to the signed-in app
 * surface, unlike support attachments which may be submitted anonymously.
 */
export const getFileMetadataBatch = authedQuery({
	args: {
		urls: v.array(v.string())
	},
	returns: v.record(
		v.string(),
		v.object({ width: v.optional(v.number()), height: v.optional(v.number()) })
	),
	handler: async (ctx, args): Promise<Record<string, { width?: number; height?: number }>> => {
		return await getFileMetadataByUrls(ctx, args.urls);
	}
});
