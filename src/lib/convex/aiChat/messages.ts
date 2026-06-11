import { internalAction, query } from '../_generated/server';
import { v, ConvexError } from 'convex/values';
import { internal } from '../_generated/api';
import { aiChatAgent } from './agent';
import { paginationOptsValidator } from 'convex/server';
import { getFile } from '@convex-dev/agent';
import { vStreamArgs } from '@convex-dev/agent/validators';
import { components } from '../_generated/api';
import type { UserContent } from 'ai';
import { aiChatRateLimiter } from './rateLimit';
import { listMessagesForThread } from '../support/messageListing';
import { authedMutation } from '../functions';
import { authComponent } from '../auth';
import { checkAndCountUsage, refundUsage } from '../autumn';
import { requireAiChatThreadRecord } from './ownership';

const THREAD_PREVIEW_LENGTH = 100;

/**
 * Send a user message and get AI response with streaming.
 *
 * Billing check happens in a separate action (checkAndTrackAiChat) called
 * by the frontend. Kept as a mutation for optimistic update support.
 */
export const sendMessage = authedMutation({
	args: {
		threadId: v.string(),
		prompt: v.string(),
		fileIds: v.optional(v.array(v.string()))
	},
	returns: v.object({ messageId: v.string() }),
	handler: async (ctx, args) => {
		if (args.prompt.length > 2000) {
			throw new ConvexError('Message is too long (max 2000 characters)');
		}

		const userId = ctx.user._id;

		// Verify thread ownership
		const record = await requireAiChatThreadRecord(ctx, {
			threadId: args.threadId,
			userId
		});

		// First send in this thread → derive a descriptive title from it. Uses
		// lastMessageAt (written on every send, never an empty string) rather than
		// lastMessage, which can be '' for a file-only first message and would
		// misidentify later sends as the first. Captured before the patch below.
		const isFirstMessage = record.lastMessageAt === undefined;

		// Consume warm thread on first message (backend-driven, no client coordination needed)
		if (record.isWarm) {
			await ctx.db.patch(record._id, { isWarm: false });
		}

		// Rate limit check
		const rateLimitStatus = await aiChatRateLimiter.limit(ctx, 'aiChatMessage', { key: userId });
		if (!rateLimitStatus.ok) {
			throw new ConvexError('Too many messages. Please wait a moment.');
		}

		let messageId: string;

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

			const result = await aiChatAgent.saveMessage(ctx, {
				threadId: args.threadId,
				message: { role: 'user', content },
				skipEmbeddings: true
			});
			messageId = result.messageId;
		} else {
			const result = await aiChatAgent.saveMessage(ctx, {
				threadId: args.threadId,
				prompt: args.prompt,
				skipEmbeddings: true
			});
			messageId = result.messageId;
		}

		// Denormalize for the sidebar. lastMessageAt is the "thread has been used"
		// signal (drives visibility + first-send); lastMessage is a display-only
		// preview, so skip it for a file-only send rather than persisting ''.
		const preview = args.prompt.trim().slice(0, THREAD_PREVIEW_LENGTH);
		await ctx.db.patch(record._id, {
			...(preview ? { lastMessage: preview } : {}),
			lastMessageAt: Date.now()
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

		return { messageId };
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
 * so a failed response never costs a message.
 */
export const createAIResponse = internalAction({
	args: {
		threadId: v.string(),
		promptMessageId: v.string(),
		userId: v.optional(v.string())
	},
	returns: v.null(),
	handler: async (ctx, args) => {
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
				return null;
			}
			// 'unavailable' fails open: generate uncounted rather than blocking
			// a legitimate user on a billing outage
			usageCounted = outcome === 'counted';
		}

		let result;
		try {
			result = await aiChatAgent.streamText(
				ctx,
				{ threadId: args.threadId, userId: args.userId },
				{ promptMessageId: args.promptMessageId },
				{
					saveStreamDeltas: {
						chunking: 'line',
						throttleMs: 100
					}
				}
			);

			await result.consumeStream();
		} catch (error) {
			// The unit was counted up front; a failed generation must not cost
			// a message. The refund window ends here: once the stream is
			// consumed the response is saved, so later denormalization errors
			// don't refund a delivered message.
			if (args.userId && usageCounted) {
				await refundUsage({ customerId: args.userId, featureId: 'ai_chat_messages' });
			}
			throw error;
		}

		// Denormalize: update thread sidebar metadata with the AI's response.
		// Trim and skip an empty preview so a whitespace-only response never lands
		// as the sidebar label (mirrors the user-message path in sendMessage).
		const responseText = await result.text;
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
export const listMessages = query({
	args: {
		threadId: v.string(),
		paginationOpts: paginationOptsValidator,
		streamArgs: vStreamArgs
	},
	// v.any(): paginated message + stream shape is owned by @convex-dev/agent
	returns: v.any(),
	handler: async (ctx, args): Promise<unknown> => {
		// Auth check
		const user = await authComponent.getAuthUser(ctx);
		if (!user) {
			throw new ConvexError('Authentication required');
		}

		// Verify ownership
		await requireAiChatThreadRecord(ctx, {
			threadId: args.threadId,
			userId: user._id
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
 */
export const getFileMetadataBatch = query({
	args: {
		urls: v.array(v.string())
	},
	returns: v.record(
		v.string(),
		v.object({ width: v.optional(v.number()), height: v.optional(v.number()) })
	),
	handler: async (ctx, args): Promise<Record<string, { width?: number; height?: number }>> => {
		const results: Record<string, { width?: number; height?: number }> = {};

		for (const url of args.urls) {
			const meta = await ctx.db
				.query('fileMetadata')
				.withIndex('by_url', (q) => q.eq('url', url))
				.first();

			if (meta && (meta.width || meta.height)) {
				results[url] = { width: meta.width, height: meta.height };
			}
		}

		return results;
	}
});
