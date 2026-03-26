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

/**
 * Send a user message and get AI response with streaming
 *
 * Pro-only enforcement is done client-side (page gates non-Pro users).
 * Supports multimodal messages with file and image attachments.
 */
export const sendMessage = authedMutation({
	args: {
		threadId: v.string(),
		prompt: v.string(),
		fileIds: v.optional(v.array(v.string()))
	},
	handler: async (ctx, args) => {
		if (args.prompt.length > 2000) {
			throw new ConvexError('Message is too long (max 2000 characters)');
		}

		const userId = ctx.user._id;

		// Verify thread ownership
		const record = await ctx.db
			.query('aiChatThreads')
			.withIndex('by_thread', (q) => q.eq('threadId', args.threadId))
			.first();
		if (!record || record.userId !== userId) {
			throw new ConvexError('Thread not found');
		}

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

		// Schedule AI response
		await ctx.scheduler.runAfter(0, internal.aiChat.messages.createAIResponse, {
			threadId: args.threadId,
			promptMessageId: messageId,
			userId
		});

		return { messageId };
	}
});

/**
 * Internal action to generate AI response with streaming
 */
export const createAIResponse = internalAction({
	args: {
		threadId: v.string(),
		promptMessageId: v.string(),
		userId: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		const result = await aiChatAgent.streamText(
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
	handler: async (ctx, args): Promise<unknown> => {
		// Auth check
		const user = await authComponent.getAuthUser(ctx);
		if (!user) {
			throw new ConvexError('Authentication required');
		}

		// Verify ownership
		const record = await ctx.db
			.query('aiChatThreads')
			.withIndex('by_thread', (q) => q.eq('threadId', args.threadId))
			.first();
		if (!record || record.userId !== user._id) {
			throw new ConvexError('Thread not found');
		}

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
