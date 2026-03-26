import { v } from 'convex/values';
import { paginationOptsValidator } from 'convex/server';
import { internalMutation, internalQuery } from '../_generated/server';
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

		// Get user's AI chat thread records (exclude warm/pre-warmed threads)
		const aiChatThreadRecords = await ctx.db
			.query('aiChatThreads')
			.withIndex('by_user', (q) => q.eq('userId', userId))
			.order('desc')
			.collect();

		const nonWarmRecords = aiChatThreadRecords.filter((r) => !r.isWarm);

		if (nonWarmRecords.length === 0) {
			return { page: [], isDone: true, continueCursor: '' };
		}

		// Get agent thread details for each
		const threadIds = nonWarmRecords.map((r) => r.threadId);

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
 * Get the current user's pre-warmed empty thread (if one exists)
 *
 * Reactive: auto-updates when a warm thread is consumed or created.
 */
export const getWarmThread = authedQuery({
	args: {},
	handler: async (ctx) => {
		const userId = ctx.user._id;

		const warmRecord = await ctx.db
			.query('aiChatThreads')
			.withIndex('by_user_warm', (q) => q.eq('userId', userId).eq('isWarm', true))
			.first();

		return warmRecord ? { threadId: warmRecord.threadId } : null;
	}
});

/**
 * Get or create a pre-warmed empty thread for the current user
 *
 * Idempotent: if a warm thread already exists, returns it.
 * Convex mutation serialization prevents duplicates across concurrent calls.
 */
export const getOrCreateWarmThread = authedMutation({
	args: {},
	handler: async (ctx) => {
		const userId = ctx.user._id;

		// Check for existing warm thread
		const existingWarm = await ctx.db
			.query('aiChatThreads')
			.withIndex('by_user_warm', (q) => q.eq('userId', userId).eq('isWarm', true))
			.first();

		if (existingWarm) {
			return { threadId: existingWarm.threadId };
		}

		// No warm thread exists — create one
		const { threadId } = await aiChatAgent.createThread(ctx, {
			userId,
			title: 'New chat'
		});

		await ctx.db.insert('aiChatThreads', {
			threadId,
			userId,
			createdAt: Date.now(),
			isWarm: true
		});

		return { threadId };
	}
});

/**
 * Delete stale warm threads (older than 7 days)
 *
 * Scheduled via cron to prevent unbounded warm thread accumulation
 * from users who create accounts but never chat.
 */
// Bounded: warm threads are rare (1 per user max), take(100) is safe
export const deleteStaleWarmThreads = internalMutation({
	args: {},
	returns: v.object({ deleted: v.number() }),
	handler: async (ctx) => {
		const cutoffTime = Date.now() - 7 * 24 * 60 * 60 * 1000;

		// Bounded: at most 1 warm thread per user, take(100) is safe
		const staleRecords = await ctx.db
			.query('aiChatThreads')
			.filter((q) =>
				q.and(q.eq(q.field('isWarm'), true), q.lt(q.field('_creationTime'), cutoffTime))
			)
			.take(100);

		let deleted = 0;
		for (const record of staleRecords) {
			await ctx.db.delete(record._id);
			deleted++;
		}

		return { deleted };
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
