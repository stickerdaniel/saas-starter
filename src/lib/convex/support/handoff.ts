import { internalMutation } from '../_generated/server';
import { v } from 'convex/values';
import { internal } from '../_generated/api';
import { syncSupportLastMessage } from './threads';

/**
 * Internal handoff used by the support agent's request_handoff tool
 * (support/tools/handoff.ts).
 *
 * Mirrors updateThreadHandoff's flag flip, denormalization sync, and admin
 * notification, but skips the canned "Talk to support" / handoff-response
 * messages: the model relays its own message in the same turn, and the
 * threadId is trusted from the agent tool context, so there is no caller to
 * authorize and no button-press text to inject.
 *
 * Kept in its own file rather than in threads.ts so the tool's internal
 * mutation stays separate from the user-facing widget mutation.
 */
export const internalSetHandoff = internalMutation({
	args: {
		threadId: v.string()
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const supportThread = await ctx.db
			.query('supportThreads')
			.withIndex('by_thread', (q) => q.eq('threadId', args.threadId))
			.first();

		if (!supportThread) {
			console.log(`[internalSetHandoff] No supportThread found for: ${args.threadId}`);
			return null;
		}

		// Already handed off - no action needed
		if (supportThread.isHandedOff) {
			return null;
		}

		// Mark as handed off - user is waiting for admin response
		await ctx.db.patch(supportThread._id, {
			isHandedOff: true,
			awaitingAdminResponse: true,
			updatedAt: Date.now()
		});

		// Keep denormalized search fields in sync
		await syncSupportLastMessage(ctx, args.threadId);

		// Notify admins that a human needs to pick up this thread (same path as the
		// widget handoff button). A handoff with no prior user messages still
		// schedules the notification; the email renders a no-messages fallback.
		const recentMessageIds = await ctx.runQuery(
			internal.admin.support.notifications.getRecentUserMessages,
			{ threadId: args.threadId }
		);

		await ctx.scheduler.runAfter(
			0,
			internal.admin.support.notifications.scheduleAdminNotification,
			{
				threadId: args.threadId,
				messageIds: recentMessageIds,
				isReopen: false,
				notificationType: 'newTickets' // Handoff from AI to human
			}
		);

		return null;
	}
});
