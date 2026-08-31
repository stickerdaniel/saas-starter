import { mutation, query } from '../_generated/server';
import { v } from 'convex/values';
import { getSupportOwnerIdentity, requireSupportThreadRecord } from './ownership';

/**
 * One past the largest number the badge spells out, so the query never scans
 * further than the UI can distinguish.
 */
const UNREAD_COUNT_CAP = 10;

/**
 * Return whether the current support owner has any unread human reply.
 *
 * Superseded by `unreadAdminReplyCount`, which the UI reads instead. Kept
 * because Convex deploys ahead of the containers: a browser still running the
 * previous release calls this until it reloads.
 */
export const hasUnreadAdminReply = query({
	args: { anonymousUserId: v.optional(v.string()) },
	returns: v.boolean(),
	handler: async (ctx, args) => {
		const owner = await getSupportOwnerIdentity(ctx, args.anonymousUserId);
		if (!owner) return false;

		const unreadThread = await ctx.db
			.query('supportThreads')
			.withIndex('by_user_and_unread_admin_reply', (q) =>
				q.eq('userId', owner.ownerId).eq('hasUnreadAdminReply', true)
			)
			.first();

		return unreadThread !== null;
	}
});

/**
 * How many unread human messages the current support owner has.
 *
 * The existing Boolean index finds only unread threads. Each thread contributes
 * its numeric count; a legacy unread thread without the field contributes one.
 * Reading at most ten threads stays sufficient: ten unread threads already put
 * the badge at its cap, while fewer threads are all needed to produce an exact
 * total below the cap.
 */
export const unreadAdminReplyCount = query({
	args: { anonymousUserId: v.optional(v.string()) },
	returns: v.number(),
	handler: async (ctx, args) => {
		const owner = await getSupportOwnerIdentity(ctx, args.anonymousUserId);
		if (!owner) return 0;

		const unreadThreads = await ctx.db
			.query('supportThreads')
			.withIndex('by_user_and_unread_admin_reply', (q) =>
				q.eq('userId', owner.ownerId).eq('hasUnreadAdminReply', true)
			)
			.take(UNREAD_COUNT_CAP);

		return unreadThreads.reduce((total, thread) => {
			const threadCount = Math.max(1, thread.unreadAdminReplyCount ?? 1);
			return Math.min(UNREAD_COUNT_CAP, total + threadCount);
		}, 0);
	}
});

/** Record that the owner opened the latest human reply in a visible conversation. */
export const markThreadRead = mutation({
	args: {
		threadId: v.string(),
		anonymousUserId: v.optional(v.string()),
		readThroughMessageId: v.string()
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const { supportThread } = await requireSupportThreadRecord(ctx, {
			threadId: args.threadId,
			anonymousUserId: args.anonymousUserId
		});
		// A newer reply may commit while this mutation is in flight. Only clear the
		// unread flag for the exact message the client rendered.
		if (
			supportThread.lastAdminReplyMessageId !== args.readThroughMessageId ||
			supportThread.hasUnreadAdminReply !== true
		) {
			return null;
		}

		// Reading is not thread activity, so it must not reorder either inbox.
		await ctx.db.patch(supportThread._id, {
			userReadAt: Date.now(),
			hasUnreadAdminReply: false,
			unreadAdminReplyCount: 0
		});
		return null;
	}
});
