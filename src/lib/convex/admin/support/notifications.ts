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
 * 5. Email sent to assigned admin, default email, or all admins
 */

import { v } from 'convex/values';
import type { Id } from '../../_generated/dataModel';
import { internalMutation, internalAction, internalQuery } from '../../_generated/server';
import { internal, components } from '../../_generated/api';
import { ADMIN_SETTING_KEYS } from '../settings/queries';
import { parseBetterAuthUsers } from '../types';

/** Delay before sending notification (2 minutes) */
const NOTIFICATION_DELAY_MS = 2 * 60 * 1000;

/**
 * Schedule or update an admin notification for a support thread
 *
 * Called when:
 * - User clicks "Talk to human" (with previous messages)
 * - User sends messages to a handed-off thread
 * - User reopens a closed ticket
 *
 * If a pending notification exists, it cancels the old scheduled job,
 * adds the new messages, and reschedules with a fresh 2-minute delay.
 *
 * @param args.threadId - The support thread ID
 * @param args.messageIds - Array of message IDs to include in the notification
 * @param args.isReopen - Whether this is a reopened ticket (true) or new ticket (false)
 */
export const scheduleAdminNotification = internalMutation({
	args: {
		threadId: v.string(),
		messageIds: v.array(v.string()),
		isReopen: v.boolean()
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
				isReopen: existing.isReopen || args.isReopen
			});
		} else {
			// Create new pending notification
			const notificationId = await ctx.db.insert('pendingAdminNotifications', {
				threadId: args.threadId,
				isReopen: args.isReopen,
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
 * Recipients (in order of priority):
 * 1. Assigned admin's email (if ticket is assigned)
 * 2. Default support email from admin settings (if configured)
 * 3. All admin users' emails (fallback)
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
		// Get the pending notification
		const notification = await ctx.runQuery(
			internal.admin.support.notifications.getPendingNotification,
			{
				notificationId: args.notificationId
			}
		);

		if (!notification) {
			// Already sent or cancelled
			console.log(
				`[sendPendingAdminNotification] Notification ${args.notificationId} not found, skipping`
			);
			return;
		}

		// Store the scheduledFnId we're running as - used to detect race conditions
		const myScheduledFnId = notification.scheduledFnId;

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

		// Determine target emails
		const targetEmails = await ctx.runQuery(
			internal.admin.support.notifications.getNotificationTargetEmails,
			{
				assignedTo: supportThread.assignedTo
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

		// If all sends failed, don't delete the notification - let it retry
		if (sentCount === 0) {
			console.error(
				`[sendPendingAdminNotification] All ${targetEmails.length} email sends failed for thread ${notification.threadId}`
			);
			return;
		}

		// Clean up the pending notification only if scheduledFnId matches
		// This prevents race condition where new messages arrived while sending
		const deleted = await ctx.runMutation(
			internal.admin.support.notifications.deletePendingNotification,
			{
				notificationId: args.notificationId,
				expectedScheduledFnId: myScheduledFnId
			}
		);

		if (deleted) {
			console.log(
				`[sendPendingAdminNotification] Sent ${notification.isReopen ? 'reopen' : 'new ticket'} notification for thread ${notification.threadId} to ${sentCount}/${targetEmails.length} recipient(s)`
			);
		} else {
			console.log(
				`[sendPendingAdminNotification] Notification was rescheduled while sending, skipped delete for thread ${notification.threadId}`
			);
		}
	}
});

// ============================================================================
// Helper queries and mutations (internal only)
// ============================================================================

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
 * Get target email addresses for admin notification
 *
 * Priority:
 * 1. Assigned admin's email
 * 2. Default support email from settings
 * 3. All admin emails
 */
export const getNotificationTargetEmails = internalQuery({
	args: {
		assignedTo: v.optional(v.string())
	},
	returns: v.array(v.string()),
	handler: async (ctx, args) => {
		const emails: string[] = [];

		// 1. If assigned, get assigned admin's email
		if (args.assignedTo) {
			const admin = await ctx.runQuery(components.betterAuth.adapter.findOne, {
				model: 'user',
				where: [{ field: '_id', operator: 'eq', value: args.assignedTo }]
			});
			if (admin?.email) {
				return [admin.email];
			}
		}

		// 2. Check for default support email in settings
		const defaultEmailSetting = await ctx.db
			.query('adminSettings')
			.withIndex('by_key', (q) => q.eq('key', ADMIN_SETTING_KEYS.DEFAULT_SUPPORT_EMAIL))
			.first();

		if (defaultEmailSetting?.value) {
			return [defaultEmailSetting.value];
		}

		// 3. Fallback: Get all admin users' emails
		const adminsResult = await ctx.runQuery(components.betterAuth.adapter.findMany, {
			model: 'user',
			paginationOpts: { cursor: null, numItems: 100 },
			where: [{ field: 'role', operator: 'eq', value: 'admin' }]
		});

		const admins = parseBetterAuthUsers(adminsResult.page);
		for (const admin of admins) {
			if (admin.email) {
				emails.push(admin.email);
			}
		}

		return emails;
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
