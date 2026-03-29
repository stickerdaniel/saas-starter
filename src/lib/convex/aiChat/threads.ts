import { v } from 'convex/values';
import { internalMutation, internalQuery } from '../_generated/server';
import { authedQuery, authedMutation } from '../functions';
import { aiChatAgent } from './agent';
import { components } from '../_generated/api';

/**
 * Strip invisible/control Unicode characters that cause infinite re-render
 * loops when rendered in DOM nodes observed by MutationObserver (autoAnimate).
 *
 * The loop: browser normalizes these chars in text nodes → Svelte detects DOM
 * differs from state → re-sets text → MutationObserver fires → repeat.
 *
 * Covers: zero-width chars (ZWSP, ZWNJ, ZWJ, WJ, BOM, soft hyphen, CGJ),
 * bidi controls, variation selectors, C0/C1 control chars, and other
 * invisible formatting characters.
 */

// Invisible Unicode chars that cause autoAnimate + Svelte 5 re-render loops.
// Built from string to satisfy eslint no-control-regex / no-misleading-character-class.
const _ranges = [
	[0x0000, 0x0008], // C0 controls (NUL..BS)
	[0x000b, 0x000b], // vertical tab
	[0x000e, 0x001f], // C0 controls (SO..US)
	[0x007f, 0x009f], // DELETE + C1 controls
	[0x00ad, 0x00ad], // soft hyphen
	[0x034f, 0x034f], // combining grapheme joiner
	[0x061c, 0x061c], // Arabic letter mark
	[0x180b, 0x180f], // Mongolian variation selectors
	[0x200b, 0x200f], // zero-width + bidi marks
	[0x202a, 0x202e], // bidi embeddings/overrides
	[0x2060, 0x2064], // word joiner + invisible math operators
	[0x2066, 0x2069], // bidi isolates
	[0xfeff, 0xfeff] // BOM / zero-width no-break space
] as const;
const INVISIBLE_CHARS = new RegExp(
	'[' +
		_ranges
			.map(([lo, hi]) =>
				lo === hi
					? String.fromCharCode(lo)
					: String.fromCharCode(lo) + '-' + String.fromCharCode(hi)
			)
			.join('') +
		']',
	'g'
);

function sanitizePreview(text: string): string {
	return text.replace(INVISIBLE_CHARS, '');
}

/**
 * List AI chat threads for the current user
 *
 * Returns threads with denormalized last message preview, ordered by most
 * recent activity. Reads only from our own aiChatThreads table — no
 * ctx.runQuery into agent component tables.
 *
 * Client uses onUpdate + $state.raw instead of useQuery to avoid Svelte 5
 * deep proxy infinite re-render loop (convex-svelte #44).
 */
export const listThreads = authedQuery({
	args: {
		limit: v.optional(v.number())
	},
	handler: async (ctx, args) => {
		const userId = ctx.user._id;
		const limit = args.limit ?? 20;

		const records = await ctx.db
			.query('aiChatThreads')
			.withIndex('by_user', (q) => q.eq('userId', userId))
			.order('desc')
			.collect();

		const validThreads = records
			.filter((r) => !r.isWarm && r.lastMessage)
			.sort((a, b) => (b.lastMessageAt ?? 0) - (a.lastMessageAt ?? 0));

		return {
			threads: validThreads.slice(0, limit).map((r) => ({
				_id: r.threadId,
				title: r.title,
				lastMessage: r.lastMessage ? sanitizePreview(r.lastMessage) : undefined,
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
		if (args.lastMessage !== undefined) patch.lastMessage = sanitizePreview(args.lastMessage);
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
					lastMessage: lastMsg.text.length > 100 ? lastMsg.text.slice(0, 100) : lastMsg.text,
					lastMessageAt: lastMsg._creationTime
				});
				updated++;
			}
		}

		return { updated, total: records.length };
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
