import { v } from 'convex/values';
import { paginationOptsValidator } from 'convex/server';
import { internalQuery } from '../_generated/server';
import { authedQuery, authedMutation } from '../functions';
import { aiChatAgent } from './agent';
import { components } from '../_generated/api';

/**
 * List AI chat threads for the current user
 *
 * Returns paginated threads with last message preview, ordered by most recent activity.
 */
export const listThreads = authedQuery({
	args: {
		paginationOpts: v.optional(paginationOptsValidator)
	},
	handler: async (ctx, _args) => {
		const userId = ctx.user._id;

		// Get user's AI chat thread records
		const aiChatThreadRecords = await ctx.db
			.query('aiChatThreads')
			.withIndex('by_user', (q) => q.eq('userId', userId))
			.order('desc')
			.collect();

		if (aiChatThreadRecords.length === 0) {
			return { page: [], isDone: true, continueCursor: '' };
		}

		// Get agent thread details for each
		const threadIds = aiChatThreadRecords.map((r) => r.threadId);

		const threadsWithLastMessage = await Promise.all(
			threadIds.map(async (threadId) => {
				// Get agent thread metadata
				const agentThread = await ctx.runQuery(components.agent.threads.getThread, {
					threadId
				});

				if (!agentThread) return null;

				// Get last completed message
				const messages = await ctx.runQuery(components.agent.messages.listMessagesByThreadId, {
					threadId,
					order: 'desc',
					statuses: ['success'],
					excludeToolMessages: true,
					paginationOpts: { numItems: 1, cursor: null }
				});

				const lastMessage = messages.page[0];

				return {
					_id: agentThread._id,
					_creationTime: agentThread._creationTime,
					title: agentThread.title,
					lastMessage: lastMessage?.text,
					lastMessageAt: lastMessage?._creationTime ?? agentThread._creationTime
				};
			})
		);

		// Filter nulls (deleted agent threads) and empty conversations (no messages),
		// then sort by last activity
		const validThreads = threadsWithLastMessage
			.filter((t): t is NonNullable<typeof t> => t !== null && !!t.lastMessage)
			.sort((a, b) => (b.lastMessageAt ?? 0) - (a.lastMessageAt ?? 0));

		return {
			page: validThreads,
			isDone: true,
			continueCursor: ''
		};
	}
});

/**
 * Create a new AI chat thread
 *
 * Creates an agent thread and a corresponding aiChatThreads record.
 */
export const createThread = authedMutation({
	args: {},
	handler: async (ctx) => {
		const userId = ctx.user._id;

		const { threadId } = await aiChatAgent.createThread(ctx, {
			userId,
			title: 'New chat'
		});

		await ctx.db.insert('aiChatThreads', {
			threadId,
			userId,
			createdAt: Date.now()
		});

		return { threadId };
	}
});

/**
 * Delete an AI chat thread
 *
 * Removes the aiChatThreads record. The agent thread data remains
 * in the agent component but is no longer accessible to the user.
 */
export const deleteThread = authedMutation({
	args: {
		threadId: v.string()
	},
	handler: async (ctx, args) => {
		const userId = ctx.user._id;

		const record = await ctx.db
			.query('aiChatThreads')
			.withIndex('by_thread', (q) => q.eq('threadId', args.threadId))
			.first();

		if (!record || record.userId !== userId) {
			throw new Error('Thread not found');
		}

		await ctx.db.delete(record._id);
	}
});

/**
 * Internal query to verify thread ownership (used by actions that can't access ctx.db)
 */
export const verifyOwnership = internalQuery({
	args: {
		threadId: v.string(),
		userId: v.string()
	},
	handler: async (ctx, args) => {
		const record = await ctx.db
			.query('aiChatThreads')
			.withIndex('by_thread', (q) => q.eq('threadId', args.threadId))
			.first();

		if (!record || record.userId !== args.userId) {
			return null;
		}

		return { threadId: record.threadId };
	}
});
