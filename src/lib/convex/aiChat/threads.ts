import { v } from 'convex/values';
import { internalMutation } from '../_generated/server';
import { authedQuery, authedMutation } from '../functions';
import { aiChatAgent } from './agent';
import { components } from '../_generated/api';
import { requireAiChatThreadRecord } from './ownership';

// aiChatThreads is the feature registry for AI chat access and sidebar state.
// agent:threads remains generic conversation storage/runtime shared across features.

const THREAD_PREVIEW_LENGTH = 100;

/**
 * List AI chat threads for the current user
 *
 * Returns threads with denormalized last message preview, ordered by most
 * recent activity. Reads only from our own aiChatThreads table — no
 * ctx.runQuery into agent component tables.
 *
 * Client uses useQuery(api.aiChat.threads.listThreads) in app layout.
 */
export const listThreads = authedQuery({
	args: {
		limit: v.optional(v.number())
	},
	handler: async (ctx, args) => {
		const userId = ctx.user._id;
		const limit = args.limit ?? 20;

		// Fetch extra to account for warm/empty threads filtered out below
		const fetchLimit = limit + 20;
		const records = await ctx.db
			.query('aiChatThreads')
			.withIndex('by_user', (q) => q.eq('userId', userId))
			.order('desc')
			.take(fetchLimit);

		const validThreads = records
			.filter((r) => !r.isWarm && r.lastMessage)
			.sort((a, b) => (b.lastMessageAt ?? 0) - (a.lastMessageAt ?? 0));

		return {
			threads: validThreads.slice(0, limit).map((r) => ({
				_id: r.threadId,
				title: r.title,
				lastMessage: r.lastMessage ?? undefined,
				lastMessageAt: r.lastMessageAt ?? r.createdAt
			})),
			hasMore: validThreads.length > limit
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

		const record = await requireAiChatThreadRecord(ctx, {
			threadId: args.threadId,
			userId
		});

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
 * Update denormalized thread metadata (called after AI response completes)
 */
export const updateThreadMetadata = internalMutation({
	args: {
		threadId: v.string(),
		lastMessage: v.optional(v.string()),
		lastMessageAt: v.optional(v.number()),
		title: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		const record = await ctx.db
			.query('aiChatThreads')
			.withIndex('by_thread', (q) => q.eq('threadId', args.threadId))
			.first();
		if (!record) return;

		const patch: Record<string, unknown> = {};
		if (args.lastMessage !== undefined) patch.lastMessage = args.lastMessage;
		if (args.lastMessageAt !== undefined) patch.lastMessageAt = args.lastMessageAt;
		if (args.title !== undefined) patch.title = args.title;

		if (Object.keys(patch).length > 0) {
			await ctx.db.patch(record._id, patch);
		}
	}
});

/**
 * Backfill denormalized fields for existing threads (one-time migration).
 * Run via: bunx convex run aiChat/threads:backfillThreadMetadata
 */
export const backfillThreadMetadata = internalMutation({
	args: {},
	handler: async (ctx) => {
		const records = await ctx.db.query('aiChatThreads').collect();
		let updated = 0;

		for (const record of records) {
			if (record.lastMessage) continue; // Already has denormalized data

			const agentThread = await ctx.runQuery(components.agent.threads.getThread, {
				threadId: record.threadId
			});

			const messages = await ctx.runQuery(components.agent.messages.listMessagesByThreadId, {
				threadId: record.threadId,
				order: 'desc',
				statuses: ['success'],
				excludeToolMessages: true,
				paginationOpts: { numItems: 1, cursor: null }
			});

			const lastMsg = messages.page[0];
			if (lastMsg?.text) {
				await ctx.db.patch(record._id, {
					title: agentThread?.title,
					lastMessage:
						lastMsg.text.length > THREAD_PREVIEW_LENGTH
							? lastMsg.text.slice(0, THREAD_PREVIEW_LENGTH)
							: lastMsg.text,
					lastMessageAt: lastMsg._creationTime
				});
				updated++;
			}
		}

		return { updated, total: records.length };
	}
});
