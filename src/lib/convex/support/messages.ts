import { internalAction, internalMutation, mutation, query } from '../_generated/server';
import { v } from 'convex/values';
import { internal } from '../_generated/api';
import { supportAgent } from './agent';
import { paginationOptsValidator } from 'convex/server';
import { listUIMessages, syncStreams, getFile } from '@convex-dev/agent';
import { vStreamArgs } from '@convex-dev/agent/validators';
import { components } from '../_generated/api';
import type { UserContent } from 'ai';
import { supportRateLimiter } from './rateLimit';
import { createRateLimitError } from './types';
import { isAnonymousUser } from '../utils/anonymousUser';
import { authComponent } from '../auth';
import { t, extractLocaleFromUrl } from '../i18n/translations';

/**
 * Send a user message and get AI response with streaming
 *
 * This mutation saves the user's message and schedules an internal action
 * to generate the AI response asynchronously with streaming support.
 *
 * Supports multimodal messages with file and image attachments.
 */
export const sendMessage = mutation({
	args: {
		threadId: v.string(),
		prompt: v.string(),
		userId: v.optional(v.string()),
		fileIds: v.optional(v.array(v.string()))
	},
	handler: async (ctx, args) => {
		// Server-side user verification for rate limiting
		// Prevents bypass by spoofing userId - uses server-verified auth when available
		const authUser = await authComponent.safeGetAuthUser(ctx);
		let effectiveUserId: string | undefined;

		if (authUser) {
			// Authenticated: Always use server-verified user ID
			effectiveUserId = authUser._id;
		} else if (args.userId && isAnonymousUser(args.userId)) {
			// Anonymous: Only allow with valid anonymous user ID format
			effectiveUserId = args.userId;
		}
		// If neither, effectiveUserId remains undefined (treated as anonymous per-thread)

		// Rate limit check - stricter limits for anonymous users
		// Authenticated users: keyed by verified user ID
		// Anonymous users: keyed by anonymous user ID (fallback: thread ID if none)
		const limitName =
			effectiveUserId && !isAnonymousUser(effectiveUserId)
				? 'supportMessage'
				: 'supportMessageAnon';
		const userKey = effectiveUserId || `anon:${args.threadId}`;

		const rateLimitStatus = await supportRateLimiter.limit(ctx, limitName, { key: userKey });

		if (!rateLimitStatus.ok) {
			// Get locale from thread's pageUrl for translated error message
			const supportThread = await ctx.db
				.query('supportThreads')
				.withIndex('by_thread', (q) => q.eq('threadId', args.threadId))
				.first();
			const locale = extractLocaleFromUrl(supportThread?.pageUrl);

			throw createRateLimitError(
				rateLimitStatus.retryAfter,
				t(locale, 'backend.support.rate_limit.user')
			);
		}

		let messageId: string;

		// Check if we have file attachments
		if (args.fileIds && args.fileIds.length > 0) {
			// Build multimodal message content
			const content: UserContent = [];

			// Add text part
			if (args.prompt.trim()) {
				content.push({
					type: 'text',
					text: args.prompt
				});
			}

			// Add file/image parts
			// Note: Dimensions are now stored separately in fileMetadata table at upload time
			// and retrieved via getFileMetadataBatch query on the frontend
			for (const fileId of args.fileIds) {
				const { filePart } = await getFile(ctx, components.agent, fileId);

				// Use filePart for all files - preserves filename for both images and PDFs
				// The mediaType field (e.g. "image/jpeg", "application/pdf") allows LLMs to identify content type
				content.push(filePart);
			}

			// Save multimodal message
			const result = await supportAgent.saveMessage(ctx, {
				threadId: args.threadId,
				message: {
					role: 'user',
					content
				},
				skipEmbeddings: true
			});

			messageId = result.messageId;
		} else {
			// Save text-only message
			const result = await supportAgent.saveMessage(ctx, {
				threadId: args.threadId,
				prompt: args.prompt,
				skipEmbeddings: true
			});

			messageId = result.messageId;
		}

		// Sync denormalized search fields with user's message
		await ctx.runMutation(internal.support.threads.updateLastMessage, {
			threadId: args.threadId
		});

		// Check if thread is handed off to human support
		// When handed off, skip AI response - only humans respond
		const supportThread = await ctx.db
			.query('supportThreads')
			.withIndex('by_thread', (q) => q.eq('threadId', args.threadId))
			.first();

		if (!supportThread?.isHandedOff) {
			// AI mode: Schedule async action to generate AI response with streaming
			await ctx.scheduler.runAfter(0, internal.support.messages.createAIResponse, {
				threadId: args.threadId,
				promptMessageId: messageId,
				userId: args.userId
			});
		}

		// Reopen thread and mark as awaiting response when user sends message
		if (supportThread) {
			// Check if this is a reopened ticket (was closed, now being reopened)
			const wasClosedBeforeThisMessage = supportThread.status === 'done';

			await ctx.db.patch(supportThread._id, {
				status: 'open',
				awaitingAdminResponse: true,
				updatedAt: Date.now()
			});

			// Schedule admin notification for handed-off tickets
			// We only notify for handed-off tickets since AI-handled tickets don't need admin attention
			// Note: scheduleAdminNotification handles both create and update cases internally
			if (supportThread.isHandedOff) {
				await ctx.scheduler.runAfter(
					0,
					internal.admin.support.notifications.scheduleAdminNotification,
					{
						threadId: args.threadId,
						messageIds: [messageId],
						isReopen: wasClosedBeforeThisMessage,
						// Reopened tickets use 'newTickets' preference; follow-up messages use 'userReplies'
						notificationType: wasClosedBeforeThisMessage ? 'newTickets' : 'userReplies'
					}
				);
			}
		}

		return { messageId };
	}
});

/**
 * Internal action to generate AI response with streaming
 *
 * This runs asynchronously and streams the AI response back to the database,
 * which automatically syncs to all connected clients via Convex's reactivity.
 */
export const createAIResponse = internalAction({
	args: {
		threadId: v.string(),
		promptMessageId: v.string(),
		userId: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		// Global rate limit check for cost protection
		// This MUST fail the request to protect against runaway costs
		const globalStatus = await supportRateLimiter.limit(ctx, 'globalLLM');
		if (!globalStatus.ok) {
			console.error(
				`[createAIResponse] Global LLM rate limit exceeded. Retry after: ${globalStatus.retryAfter}ms`
			);

			// Get locale from thread's pageUrl for translated message
			const locale = await ctx.runQuery(internal.support.threads.getThreadLocale, {
				threadId: args.threadId
			});

			// Save a system message so user knows why there's no response
			await ctx.runMutation(internal.support.messages.createAssistantMessage, {
				threadId: args.threadId,
				text: t(locale, 'backend.support.rate_limit.global')
			});

			// Don't throw - message saved explains the situation
			return;
		}

		// Stream the AI response with tool execution support
		// maxSteps is configured at the agent level (agent.ts) for multi-step tool execution
		const result = await supportAgent.streamText(
			ctx,
			{ threadId: args.threadId, userId: args.userId },
			{
				promptMessageId: args.promptMessageId
			},
			{
				// Save streaming deltas to database for real-time updates
				saveStreamDeltas: {
					chunking: 'line',
					throttleMs: 100
				}
			}
		);

		// Consume the stream to process all tool calls and responses
		await result.consumeStream();

		// Sync denormalized search fields with AI response
		await ctx.runMutation(internal.support.threads.updateLastMessage, {
			threadId: args.threadId
		});
	}
});

/**
 * List messages in a thread with streaming support
 *
 * Returns paginated messages with streaming deltas included.
 * This query is reactive and will automatically update when new messages or
 * streaming deltas arrive.
 *
 * Note: We fetch messages using listMessagesByThreadId and enrich with UIMessage
 * format because listUIMessages doesn't include custom metadata fields.
 */
export const listMessages = query({
	args: {
		threadId: v.string(),
		paginationOpts: paginationOptsValidator,
		streamArgs: vStreamArgs
	},
	handler: async (ctx, args): Promise<unknown> => {
		// Get paginated UIMessages (includes id field and text for display)
		const paginated = await listUIMessages(ctx, components.agent, {
			threadId: args.threadId,
			paginationOpts: args.paginationOpts
		});

		// Get raw messages to access metadata (listUIMessages doesn't include it)
		// Skip when numItems is 0 (delta-only queries don't need metadata)
		let rawMessages: { page: Array<{ _id: string; metadata?: Record<string, unknown> }> } = {
			page: []
		};
		if (args.paginationOpts.numItems > 0) {
			rawMessages = await ctx.runQuery(components.agent.messages.listMessagesByThreadId, {
				threadId: args.threadId,
				paginationOpts: args.paginationOpts,
				order: 'asc'
			});
		}

		// Create a map of message id -> metadata
		// Note: metadata fields (provider, providerMetadata) are stored as top-level fields
		const metadataMap = new Map<string, Record<string, unknown>>();
		for (const msg of rawMessages.page) {
			const rawMsg = msg as unknown as {
				_id: string;
				provider?: string;
				providerMetadata?: Record<string, unknown>;
			};
			// Only create metadata object if provider fields exist
			if (rawMsg.provider || rawMsg.providerMetadata) {
				metadataMap.set(rawMsg._id, {
					provider: rawMsg.provider,
					providerMetadata: rawMsg.providerMetadata
				});
			}
		}

		// Enrich UIMessages with metadata
		const enrichedPage = paginated.page.map((msg) => ({
			...msg,
			metadata: metadataMap.get(msg.id)
		}));

		// Get streaming deltas for in-progress messages
		const streams = await syncStreams(ctx, components.agent, {
			threadId: args.threadId,
			streamArgs: args.streamArgs,
			includeStatuses: ['streaming', 'finished', 'aborted']
		});

		return { ...paginated, page: enrichedPage, streams };
	}
});

/**
 * Delete a message
 *
 * Removes a message from the thread. Useful for moderating content
 * or allowing users to remove their messages.
 */
export const deleteMessage = mutation({
	args: {
		messageId: v.string()
	},
	handler: async (ctx, args) => {
		await supportAgent.deleteMessage(ctx, {
			messageId: args.messageId
		});
	}
});

/**
 * Internal mutation to save an assistant message
 *
 * Used to send follow-up messages after async operations complete,
 * such as after a support ticket is successfully submitted.
 */
export const createAssistantMessage = internalMutation({
	args: {
		threadId: v.string(),
		text: v.string()
	},
	handler: async (ctx, args) => {
		return await supportAgent.saveMessage(ctx, {
			threadId: args.threadId,
			message: {
				role: 'assistant',
				content: args.text
			},
			skipEmbeddings: true
		});
	}
});

/**
 * Get file metadata (dimensions) for multiple files by URL
 *
 * Used to load image dimensions for proper dialog sizing when
 * displaying message attachments. Queries directly by URL since
 * we store the URL from the agent component.
 *
 * Returns a map of URL -> dimensions.
 */
export const getFileMetadataBatch = query({
	args: {
		urls: v.array(v.string())
	},
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
