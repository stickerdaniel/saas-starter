import { mutation, query } from '../_generated/server';
import { v } from 'convex/values';
import { getSupportOwnerIdentity, requireSupportThreadRecord } from './ownership';

/** Return whether the current support owner has any unread human reply. */
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

/** Record that the owner opened the latest human reply in a visible conversation. */
export const markThreadRead = mutation({
	args: {
		threadId: v.string(),
		anonymousUserId: v.optional(v.string())
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const { supportThread } = await requireSupportThreadRecord(ctx, args);
		const lastAdminReplyAt = supportThread.lastAdminReplyAt;
		if (lastAdminReplyAt === undefined) return null;

		if (
			supportThread.hasUnreadAdminReply !== true &&
			(supportThread.userReadAt ?? 0) >= lastAdminReplyAt
		) {
			return null;
		}

		// Reading is not thread activity, so it must not reorder either inbox.
		await ctx.db.patch(supportThread._id, {
			userReadAt: Date.now(),
			hasUnreadAdminReply: false
		});
		return null;
	}
});
