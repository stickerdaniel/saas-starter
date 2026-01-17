/**
 * Debounced Admin Notification System
 *
 * Sends email notifications to admins when:
 * - New support tickets are created (user clicks "Talk to human")
 * - Closed tickets are reopened (user sends message to closed ticket)
 * - Users send messages to handed-off tickets awaiting admin response
 *
 * Uses a 2-minute debounce to accumulate multiple messages before sending.
 *
 * Flow:
 * 1. User triggers notification (handoff, new message to handed-off ticket, or reopen)
 * 2. scheduleAdminNotification creates/updates pending notification with 2-min delay
 * 3. If user sends more messages, timer resets and messages accumulate
 * 4. After 2 minutes of no new messages, sendPendingAdminNotification fires
 * 5. Email sent to recipients based on adminNotificationPreferences table
 */

import { v } from 'convex/values';
import type { Id } from '../../_generated/dataModel';
import { internalMutation, internalAction, internalQuery } from '../../_generated/server';
import { internal, components } from '../../_generated/api';

/** Delay before sending notification (2 minutes) */
const NOTIFICATION_DELAY_MS = 2 * 60 * 1000;

/**
 * Schedule or update an admin notification for a support thread
 *
 * Called when:
 * - User clicks "Talk to human" (with previous messages) → notificationType: 'newTickets'
 * - User sends messages to a handed-off thread → notificationType: 'userReplies'
 * - User reopens a closed ticket → notificationType: 'newTickets'
 *
 * If a pending notification exists, it cancels the old scheduled job,
 * adds the new messages, and reschedules with a fresh 2-minute delay.
 *
 * @param args.threadId - The support thread ID
 * @param args.messageIds - Array of message IDs to include in the notification
 * @param args.isReopen - Whether this is a reopened ticket (true) or new ticket (false)
 * @param args.notificationType - Which preference toggle to check ('newTickets' or 'userReplies')
 */
export const scheduleAdminNotification = internalMutation({
	args: {
		threadId: v.string(),
		messageIds: v.array(v.string()),
		isReopen: v.boolean(),
		notificationType: v.union(v.literal('newTickets'), v.literal('userReplies'))
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		// Skip if no messages to notify about
		if (args.messageIds.length === 0) {
			return null;
		}

		const now = Date.now();
		const scheduledFor = now + NOTIFICATION_DELAY_MS;

		// Check for existing pending notification for this thread
		const existing = await ctx.db
			.query('pendingAdminNotifications')
			.withIndex('by_thread', (q) => q.eq('threadId', args.threadId))
			.first();

		if (existing) {
			// Cancel the existing scheduled function if it's still pending
			if (existing.scheduledFnId) {
				const scheduledFn = await ctx.db.system.get(existing.scheduledFnId);
				if (scheduledFn?.state.kind === 'pending') {
					await ctx.scheduler.cancel(existing.scheduledFnId);
				}
			}

			// Update existing notification: add new messages (deduplicate)
			const existingSet = new Set(existing.messageIds);
			const newMessageIds = args.messageIds.filter((id) => !existingSet.has(id));
			const updatedMessageIds = [...existing.messageIds, ...newMessageIds];

			// Schedule new notification
			const newScheduledFnId = await ctx.scheduler.runAfter(
				NOTIFICATION_DELAY_MS,
				internal.admin.support.notifications.sendPendingAdminNotification,
				{
					notificationId: existing._id
				}
			);

			await ctx.db.patch(existing._id, {
				messageIds: updatedMessageIds,
				scheduledFor,
				scheduledFnId: newScheduledFnId,
				isReopen: existing.isReopen || args.isReopen,
				// Preserve 'newTickets' if either call was for new ticket (primary event)
				notificationType:
					existing.notificationType === 'newTickets' ? 'newTickets' : args.notificationType
			});
		} else {
			// Create new pending notification
			const notificationId = await ctx.db.insert('pendingAdminNotifications', {
				threadId: args.threadId,
				isReopen: args.isReopen,
				notificationType: args.notificationType,
				scheduledFor,
				messageIds: args.messageIds,
				createdAt: now
			});

			// Schedule the notification to be sent
			const scheduledFnId = await ctx.scheduler.runAfter(
				NOTIFICATION_DELAY_MS,
				internal.admin.support.notifications.sendPendingAdminNotification,
				{
					notificationId
				}
			);

			// Update with the scheduled function ID
			await ctx.db.patch(notificationId, {
				scheduledFnId
			});
		}

		return null;
	}
});

/**
 * Send a pending admin notification
 *
 * Called by the scheduler after the debounce period expires.
 * Fetches all accumulated messages and sends email to the appropriate recipients.
 *
 * Recipient selection (via adminNotificationPreferences table):
 * - If ticket is assigned AND assignee has the notification type enabled → only assignee
 * - Otherwise → all recipients with the notification type enabled (admins + custom emails)
 *
 * Race condition protection: Before deleting the pending notification, we verify
 * that scheduledFnId hasn't changed. If it has, a new notification was scheduled
 * while this action was running, and we should not delete the record.
 *
 * @param args.notificationId - The pending notification record ID
 */
export const sendPendingAdminNotification = internalAction({
	args: {
		notificationId: v.id('pendingAdminNotifications')
	},
	handler: async (ctx, args) => {
		// Claim ownership atomically before doing any work
		// This follows the "claim-then-act" pattern - the idiomatic Convex approach
		// The mutation checks that scheduledFnId is set (not already claimed) and clears it
		const notification = await ctx.runMutation(
			internal.admin.support.notifications.claimNotificationForSending,
			{
				notificationId: args.notificationId
			}
		);

		if (!notification) {
			// Already claimed by another instance, rescheduled, or deleted
			console.log(
				`[sendPendingAdminNotification] Notification ${args.notificationId} not claimable (already claimed or rescheduled), skipping`
			);
			return;
		}

		// Get support thread data
		const supportThread = await ctx.runQuery(
			internal.admin.support.notifications.getSupportThread,
			{
				threadId: notification.threadId
			}
		);

		if (!supportThread) {
			console.log(
				`[sendPendingAdminNotification] Thread ${notification.threadId} not found, skipping`
			);
			// Clean up the pending notification (force delete since thread is gone)
			await ctx.runMutation(internal.admin.support.notifications.deletePendingNotification, {
				notificationId: args.notificationId
			});
			return;
		}

		// Determine target emails based on stored notification type
		// - 'newTickets' for handoffs and reopened tickets
		// - 'userReplies' for follow-up messages to handed-off tickets
		const targetEmails = await ctx.runQuery(
			internal.admin.support.notifications.getNotificationTargetEmails,
			{
				assignedTo: supportThread.assignedTo,
				notificationType: notification.notificationType
			}
		);

		if (targetEmails.length === 0) {
			console.log('[sendPendingAdminNotification] No target emails found, skipping notification');
			// Clean up the pending notification (force delete since no recipients)
			await ctx.runMutation(internal.admin.support.notifications.deletePendingNotification, {
				notificationId: args.notificationId
			});
			return;
		}

		// Fetch message contents
		const messages = await ctx.runQuery(internal.admin.support.notifications.getMessageContents, {
			messageIds: notification.messageIds
		});

		// Send email to each target with per-recipient error handling
		let sentCount = 0;
		for (const email of targetEmails) {
			try {
				await ctx.runMutation(internal.emails.send.sendNewTicketAdminNotification, {
					email,
					isReopen: notification.isReopen,
					userName: supportThread.userName || 'Anonymous',
					messages,
					threadId: notification.threadId
				});
				sentCount++;
			} catch (error) {
				// Log error but continue to other recipients
				console.error(
					`[sendPendingAdminNotification] Failed to send email to ${email}:`,
					error instanceof Error ? error.message : error
				);
			}
		}

		// If all sends failed, reschedule for retry
		if (sentCount === 0) {
			console.error(
				`[sendPendingAdminNotification] All ${targetEmails.length} email sends failed for thread ${notification.threadId}, rescheduling...`
			);
			// Reschedule with 1 minute delay via mutation (for guaranteed delivery semantics)
			await ctx.runMutation(internal.admin.support.notifications.reschedulePendingNotification, {
				notificationId: args.notificationId,
				delayMs: 60_000 // 1 minute retry delay
			});
			return;
		}

		// Clean up the pending notification
		// We already claimed ownership at the start, so we can delete unconditionally
		await ctx.runMutation(internal.admin.support.notifications.deletePendingNotification, {
			notificationId: args.notificationId
		});

		console.log(
			`[sendPendingAdminNotification] Sent ${notification.isReopen ? 'reopen' : 'new ticket'} notification for thread ${notification.threadId} to ${sentCount}/${targetEmails.length} recipient(s)`
		);
	}
});

// ============================================================================
// Helper queries and mutations (internal only)
// ============================================================================

/**
 * Claim ownership of a pending notification before sending
 *
 * Uses atomic mutation to prevent race conditions. Only one action can claim
 * a notification - once claimed, scheduledFnId is cleared to prevent other
 * actions from proceeding.
 *
 * This follows the "claim-then-act" pattern which is the idiomatic Convex
 * approach for coordinating work in actions:
 * - pending (scheduledFnId set) → claimed (scheduledFnId cleared) → deleted
 *
 * @param args.notificationId - The notification to claim
 * @returns The notification data if claimed, null if already claimed or not found
 */
export const claimNotificationForSending = internalMutation({
	args: {
		notificationId: v.id('pendingAdminNotifications')
	},
	returns: v.union(
		v.object({
			threadId: v.string(),
			messageIds: v.array(v.string()),
			isReopen: v.boolean(),
			notificationType: v.union(v.literal('newTickets'), v.literal('userReplies'))
		}),
		v.null()
	),
	handler: async (ctx, args) => {
		const notification = await ctx.db.get(args.notificationId);

		// Not found or already claimed (scheduledFnId is undefined when claimed)
		if (!notification || notification.scheduledFnId === undefined) {
			return null;
		}

		// Clear scheduledFnId to claim ownership atomically
		// This prevents other actions from claiming this notification
		await ctx.db.patch(args.notificationId, { scheduledFnId: undefined });

		return {
			threadId: notification.threadId,
			messageIds: notification.messageIds,
			isReopen: notification.isReopen,
			notificationType: notification.notificationType
		};
	}
});

/**
 * Get a pending notification by ID
 */
export const getPendingNotification = internalQuery({
	args: {
		notificationId: v.id('pendingAdminNotifications')
	},
	returns: v.union(
		v.object({
			_id: v.id('pendingAdminNotifications'),
			_creationTime: v.number(),
			threadId: v.string(),
			isReopen: v.boolean(),
			notificationType: v.union(v.literal('newTickets'), v.literal('userReplies')),
			scheduledFor: v.number(),
			messageIds: v.array(v.string()),
			scheduledFnId: v.optional(v.id('_scheduled_functions')),
			createdAt: v.number()
		}),
		v.null()
	),
	handler: async (ctx, args) => {
		return await ctx.db.get(args.notificationId);
	}
});

/**
 * Get support thread data for notification
 */
export const getSupportThread = internalQuery({
	args: {
		threadId: v.string()
	},
	handler: async (ctx, args) => {
		return await ctx.db
			.query('supportThreads')
			.withIndex('by_thread', (q) => q.eq('threadId', args.threadId))
			.first();
	}
});

/**
 * Delete a pending notification
 *
 * If expectedScheduledFnId is provided, only deletes if the notification's
 * scheduledFnId matches. This prevents race conditions where a new notification
 * was scheduled while the action was running.
 *
 * @param args.notificationId - The notification to delete
 * @param args.expectedScheduledFnId - If provided, only delete if scheduledFnId matches
 * @returns true if deleted, false if not found or scheduledFnId didn't match
 */
export const deletePendingNotification = internalMutation({
	args: {
		notificationId: v.id('pendingAdminNotifications'),
		expectedScheduledFnId: v.optional(v.id('_scheduled_functions'))
	},
	returns: v.boolean(),
	handler: async (ctx, args) => {
		const notification = await ctx.db.get(args.notificationId);

		// Not found - already deleted
		if (!notification) {
			return false;
		}

		// If expectedScheduledFnId provided, check it matches
		// This prevents deleting a notification that was rescheduled
		if (args.expectedScheduledFnId && notification.scheduledFnId !== args.expectedScheduledFnId) {
			return false;
		}

		await ctx.db.delete(args.notificationId);
		return true;
	}
});

/**
 * Reschedule a pending notification for retry
 *
 * Called when all email sends fail to ensure the notification is retried later.
 * Updates the scheduledFnId to point to the new scheduled function.
 *
 * @param args.notificationId - The notification to reschedule
 * @param args.delayMs - Delay in milliseconds before retry (default 60 seconds)
 */
export const reschedulePendingNotification = internalMutation({
	args: {
		notificationId: v.id('pendingAdminNotifications'),
		delayMs: v.optional(v.number())
	},
	returns: v.boolean(),
	handler: async (ctx, args) => {
		const notification = await ctx.db.get(args.notificationId);

		if (!notification) {
			return false;
		}

		const delayMs = args.delayMs ?? 60_000; // Default 1 minute

		// Schedule new send attempt
		const newScheduledFnId = await ctx.scheduler.runAfter(
			delayMs,
			internal.admin.support.notifications.sendPendingAdminNotification,
			{ notificationId: args.notificationId }
		);

		// Update notification with new scheduled function ID
		await ctx.db.patch(args.notificationId, {
			scheduledFor: Date.now() + delayMs,
			scheduledFnId: newScheduledFnId
		});

		console.log(
			`[reschedulePendingNotification] Rescheduled notification for thread ${notification.threadId} with ${delayMs}ms delay`
		);

		return true;
	}
});

/**
 * Get target email addresses for admin notification
 *
 * Uses the adminNotificationPreferences table to determine recipients.
 * If assigned admin has the notification enabled, prioritizes them.
 * Otherwise returns all recipients with the notification type enabled.
 *
 * @param assignedTo - Optional admin user ID for ticket assignment priority
 * @param notificationType - Type of notification ('newTickets' or 'userReplies')
 */
export const getNotificationTargetEmails = internalQuery({
	args: {
		assignedTo: v.optional(v.string()),
		notificationType: v.union(v.literal('newTickets'), v.literal('userReplies'))
	},
	returns: v.array(v.string()),
	handler: async (ctx, args) => {
		// Get all preferences
		const allPrefs = await ctx.db.query('adminNotificationPreferences').collect();

		// Map notification type to field name
		const toggleField =
			args.notificationType === 'newTickets' ? 'notifyNewSupportTickets' : 'notifyUserReplies';

		// Filter to active recipients (admins or custom emails) with this notification enabled
		const activePrefs = allPrefs.filter(
			(p) => (p.isAdminUser || p.userId === undefined) && p[toggleField]
		);

		// If assigned admin has this notification enabled, prioritize them
		if (args.assignedTo) {
			const assignedPref = activePrefs.find((p) => p.userId === args.assignedTo);
			if (assignedPref) {
				return [assignedPref.email];
			}
		}

		return activePrefs.map((p) => p.email);
	}
});

/**
 * Get message contents for notification
 *
 * Fetches messages from the agent component and formats them for the email.
 * Truncates messages longer than 500 characters to keep email size reasonable.
 */
export const getMessageContents = internalQuery({
	args: {
		messageIds: v.array(v.string())
	},
	returns: v.array(v.object({ text: v.string(), timestamp: v.string() })),
	handler: async (ctx, args) => {
		const messages: Array<{ text: string; timestamp: string }> = [];

		// Fetch all messages in batch using getMessagesByIds
		// Note: messageIds are stored as strings but the agent component expects typed IDs
		const messagesResult = await ctx.runQuery(components.agent.messages.getMessagesByIds, {
			messageIds: args.messageIds as Id<'messages'>[]
		});

		for (const message of messagesResult) {
			if (message?.text) {
				// Format timestamp
				const date = new Date(message._creationTime);
				const timestamp = date.toLocaleString('en-US', {
					month: 'short',
					day: 'numeric',
					hour: 'numeric',
					minute: '2-digit',
					hour12: true
				});

				messages.push({
					text: message.text.slice(0, 500), // Truncate long messages
					timestamp
				});
			}
		}

		return messages;
	}
});

/**
 * Get recent user messages from a thread for notification
 *
 * Fetches user messages from a thread, excluding:
 * - AI/assistant messages
 * - System messages like "Talk to support"
 *
 * Used when user clicks "Talk to human" to include previous messages in notification.
 * Returns up to 10 messages by default to keep notification email focused.
 */
export const getRecentUserMessages = internalQuery({
	args: {
		threadId: v.string(),
		limit: v.optional(v.number())
	},
	returns: v.array(v.string()),
	handler: async (ctx, args) => {
		const maxMessages = args.limit ?? 10;

		// Fetch recent messages from the thread (newest first)
		const result = await ctx.runQuery(components.agent.messages.listMessagesByThreadId, {
			threadId: args.threadId,
			order: 'desc',
			statuses: ['success'],
			paginationOpts: { numItems: 50, cursor: null }
		});

		// Filter to only user messages, excluding "Talk to support" system message
		const userMessages = result.page.filter((msg) => {
			if (msg.message?.role !== 'user') return false;

			// Extract text from the message
			const text =
				typeof msg.message.content === 'string'
					? msg.message.content
					: Array.isArray(msg.message.content)
						? msg.message.content
								.filter((p): p is { type: 'text'; text: string } => p.type === 'text')
								.map((p) => p.text)
								.join(' ')
						: '';

			// Exclude the "Talk to support" system message
			if (text.toLowerCase().trim() === 'talk to support') return false;

			return true;
		});

		// Take only the most recent messages and reverse to chronological order
		const recentMessages = userMessages.slice(0, maxMessages).reverse();

		return recentMessages.map((msg) => msg._id);
	}
});

/**
 * Cancel a pending notification for a thread
 *
 * Called when a ticket is closed or assigned before the notification is sent.
 * This prevents stale notifications from being sent.
 *
 * @returns true if cancelled, false if no pending notification found
 */
export const cancelPendingNotification = internalMutation({
	args: {
		threadId: v.string()
	},
	returns: v.boolean(),
	handler: async (ctx, args) => {
		const pending = await ctx.db
			.query('pendingAdminNotifications')
			.withIndex('by_thread', (q) => q.eq('threadId', args.threadId))
			.first();

		if (!pending) {
			return false;
		}

		// Cancel scheduled function if still pending
		if (pending.scheduledFnId) {
			const scheduledFn = await ctx.db.system.get(pending.scheduledFnId);
			if (scheduledFn?.state.kind === 'pending') {
				await ctx.scheduler.cancel(pending.scheduledFnId);
			}
		}

		// Delete the pending notification
		await ctx.db.delete(pending._id);
		return true;
	}
});
