/**
 * Debounced Admin Notification System
 *
 * Sends email notifications to admins when:
 * - New support tickets are created (user clicks "Talk to human")
 * - Closed tickets are reopened (user sends message to closed ticket)
 * - Users send messages to handed-off tickets awaiting admin response
 *
 * Uses a 4-minute debounce to accumulate multiple messages before sending,
 * capped at 15 minutes after the first trigger.
 *
 * Flow:
 * 1. User triggers notification (handoff, new message to handed-off ticket, or reopen)
 * 2. scheduleAdminNotification creates/updates the pending notification with a 4-minute delay
 * 3. If user sends more messages, timer resets and messages accumulate
 * 4. After 4 minutes of no new messages, or 15 minutes after the first trigger,
 *    sendPendingAdminNotification fires
 * 5. Email sent to recipients based on adminNotificationPreferences table
 */

import { v } from 'convex/values';
import { paginationOptsValidator } from 'convex/server';
import type { Doc, Id } from '../../_generated/dataModel';
import {
	internalMutation,
	internalAction,
	internalQuery,
	type MutationCtx
} from '../../_generated/server';
import { internal, components } from '../../_generated/api';
import { supportThreadFields } from '../../support/supportThreadFields';
import { receivesNotification } from '../notificationPreferences/queries';
import { getEmailDeliveryConfiguration } from '../../emails/resend';
import { shouldSkipTestEmail } from '../../emails/helpers';

/** Delay before sending a notification after the latest message. */
const NOTIFICATION_DELAY_MS = 4 * 60 * 1000;

/**
 * Latest send time after a pending notification's createdAt. Without it, a
 * customer who writes more often than NOTIFICATION_DELAY_MS keeps pushing the
 * send back and no admin is ever alerted.
 */
const MAX_DEBOUNCE_AGE_MS = 15 * 60 * 1000;

/** Maximum number of retry attempts before giving up */
const MAX_RETRY_COUNT = 5;

// Convex runtime actions have a 30-minute maximum, plus a minute for recovery margin.
// https://docs.convex.dev/production/state/limits
const CLAIM_LEASE_MS = 31 * 60 * 1000;

async function cancelRecovery(ctx: MutationCtx, notification: Doc<'pendingAdminNotifications'>) {
	if (
		notification.recoveryFnId &&
		(await ctx.db.system.get(notification.recoveryFnId))?.state.kind === 'pending'
	)
		await ctx.scheduler.cancel(notification.recoveryFnId);
}

async function finishNotification(
	ctx: MutationCtx,
	notification: Doc<'pendingAdminNotifications'>
) {
	await cancelRecovery(ctx, notification);
	await ctx.db.delete('pendingAdminNotifications', notification._id);
	if (
		await ctx.db
			.query('supportNotificationReceipts')
			.withIndex('by_notificationId_and_generation_and_email', (q) =>
				q.eq('notificationId', notification._id)
			)
			.first()
	)
		await ctx.scheduler.runAfter(0, internal.admin.support.notificationDelivery.cleanupReceipts, {
			notificationId: notification._id,
			cursor: null
		});
}

/** Logged when the running send no longer owns its row and skips cleanup. */
const OWNERSHIP_MOVED_LOG =
	'[sendPendingAdminNotification] Pending notification no longer owned by this send; row was re-armed, claimed by a newer send, or cancelled, skipping cleanup:';

/**
 * Schedule or update an admin notification for a support thread
 *
 * Called when:
 * - User clicks "Talk to human" (with previous messages) → notificationType: 'newTickets'
 * - User sends messages to a handed-off thread → notificationType: 'userReplies'
 * - User reopens a closed ticket → notificationType: 'newTickets'
 *
 * If a pending notification exists, it cancels the old scheduled job,
 * adds the new messages, and reschedules with a fresh 4-minute delay, but no
 * later than 15 minutes after the row was created and no earlier than its
 * current deadline. A row claimed by a running send starts a fresh window.
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
		if (getEmailDeliveryConfiguration().state !== 'ready') return null;

		// A handoff with no prior user messages (a bare "Talk to a human") still
		// notifies admins. Downstream the email renders a no-messages fallback line
		// instead of message excerpts.
		const now = Date.now();

		// Check for existing pending notification for this thread
		const existing = await ctx.db
			.query('pendingAdminNotifications')
			.withIndex('by_thread', (q) => q.eq('threadId', args.threadId))
			.first();

		if (existing) {
			await cancelRecovery(ctx, existing);
			// A row without a scheduled function is claimed by a running send, which
			// already emails its messages. Re-arming it starts a fresh window, so a
			// row past its cap does not repeat those messages seconds later.
			const claimedBySend = existing.scheduledFnId === undefined;

			// Otherwise each message restarts the delay, but never past the cap from
			// the row's creation, and never earlier than the current deadline, so a
			// message cannot cut short a retry's backoff. The floor at now keeps a
			// passed cap from a negative delay, which runAfter rejects.
			const scheduledFor = claimedBySend
				? now + NOTIFICATION_DELAY_MS
				: Math.max(
						now,
						existing.scheduledFor,
						Math.min(now + NOTIFICATION_DELAY_MS, existing.createdAt + MAX_DEBOUNCE_AGE_MS)
					);

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
				scheduledFor - now,
				internal.admin.support.notifications.sendPendingAdminNotification,
				{
					notificationId: existing._id
				}
			);

			// Writing scheduledFnId and clearing claimToken also evicts an in-flight
			// sender: a send owns the row only while it is unscheduled and still carries
			// that send's claim token, so this patch hands ownership to the new job.
			await ctx.db.patch('pendingAdminNotifications', existing._id, {
				messageIds: updatedMessageIds,
				scheduledFor,
				// The fresh window after a claimed send gets its own cap
				...(claimedBySend ? { createdAt: now } : {}),
				scheduledFnId: newScheduledFnId,
				claimToken: undefined,
				generation: crypto.randomUUID(),
				claimLeaseExpiresAt: undefined,
				recoveryFnId: undefined,
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
				scheduledFor: now + NOTIFICATION_DELAY_MS,
				messageIds: args.messageIds,
				generation: crypto.randomUUID(),
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
			await ctx.db.patch('pendingAdminNotifications', notificationId, {
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
 * Ownership protocol: the claim clears scheduledFnId and writes a fresh claim
 * token, and every mutation this action runs afterwards passes that token and
 * may only touch the row while it is still unscheduled and carries the same
 * token. Email sends take seconds outside any transaction, so a customer message
 * can arrive in that window, re-arm the row with a fresh scheduled function and
 * take ownership back. The re-armed send may even claim the row before this one
 * finishes; its new token keeps this send from deleting or retrying that claim.
 * The delete and reschedule below then do nothing, and the newer send delivers
 * the accumulated messages.
 *
 * @param args.notificationId - The pending notification record ID
 */
export const sendPendingAdminNotification = internalAction({
	args: {
		notificationId: v.id('pendingAdminNotifications')
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		// Claim ownership atomically before doing any work
		// This follows the "claim-then-act" pattern - the idiomatic Convex approach
		// The mutation checks that scheduledFnId is set (not already claimed), clears
		// it, and returns the claim token every later cleanup must present
		const notification = await ctx.runMutation(
			internal.admin.support.notifications.claimNotificationForSending,
			{
				notificationId: args.notificationId,
				issueToken: true,
				receiptProtocol: 1
			}
		);

		if (!notification) {
			// Already claimed by another instance, rescheduled, or deleted
			console.log(
				`[sendPendingAdminNotification] Notification ${args.notificationId} not claimable (already claimed or rescheduled), skipping`
			);
			return null;
		}

		if (getEmailDeliveryConfiguration().state !== 'ready') {
			const deleted = await ctx.runMutation(
				internal.admin.support.notifications.deletePendingNotification,
				{
					notificationId: args.notificationId,
					claimToken: notification.claimToken
				}
			);
			if (!deleted) console.log(OWNERSHIP_MOVED_LOG, args.notificationId);
			return null;
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
			// Clean up the pending notification (the thread is gone)
			const deleted = await ctx.runMutation(
				internal.admin.support.notifications.deletePendingNotification,
				{
					notificationId: args.notificationId,
					claimToken: notification.claimToken
				}
			);
			if (!deleted) console.log(OWNERSHIP_MOVED_LOG, args.notificationId);
			return null;
		}

		// Determine target emails based on stored notification type
		// - 'newTickets' for handoffs and reopened tickets
		// - 'userReplies' for follow-up messages to handed-off tickets
		// E2E test addresses are never sent to, so they are dropped here: they must
		// neither count as a delivery nor keep an all-test notification retrying.
		const targetEmails = (
			await ctx.runQuery(internal.admin.support.notifications.getNotificationTargetEmails, {
				assignedTo: supportThread.assignedTo,
				notificationType: notification.notificationType
			})
		).filter((email) => !shouldSkipTestEmail('sendPendingAdminNotification', email));

		if (targetEmails.length === 0) {
			console.log('[sendPendingAdminNotification] No target emails found, skipping notification');
			// Clean up the pending notification (there are no recipients)
			const deleted = await ctx.runMutation(
				internal.admin.support.notifications.deletePendingNotification,
				{
					notificationId: args.notificationId,
					claimToken: notification.claimToken
				}
			);
			if (!deleted) console.log(OWNERSHIP_MOVED_LOG, args.notificationId);
			return null;
		}

		// Fetch message contents
		const messages = await ctx.runQuery(internal.admin.support.notifications.getMessageContents, {
			messageIds: notification.messageIds
		});

		// Send email to each target with per-recipient error handling
		let sentCount = 0;
		for (const email of targetEmails) {
			try {
				const enqueued = await ctx.runMutation(
					internal.admin.support.notificationDelivery.enqueueRecipient,
					{
						notificationId: args.notificationId,
						generation: notification.generation,
						claimToken: notification.claimToken,
						email,
						isReopen: notification.isReopen,
						// A handoff with no accumulated messages is a bare "Talk to a human",
						// so the email's empty-state line names the handoff instead of the
						// neutral "no messages" shared with reopen/reply notifications.
						isBareHandoff: notification.messageIds.length === 0,
						userName: supportThread.userName || 'Anonymous',
						messages,
						threadId: notification.threadId
					}
				);
				if (enqueued) sentCount++;
			} catch (error) {
				// Log error but continue to other recipients
				console.error(
					`[sendPendingAdminNotification] Failed to send email to ${email}:`,
					error instanceof Error ? error.message : error
				);
			}
		}

		// If configuration changed while recipient sends were running, finish the
		// claimed row instead of retrying work that cannot reach the provider.
		if (sentCount === 0 && getEmailDeliveryConfiguration().state !== 'ready') {
			const deleted = await ctx.runMutation(
				internal.admin.support.notifications.deletePendingNotification,
				{
					notificationId: args.notificationId,
					claimToken: notification.claimToken
				}
			);
			if (!deleted) console.log(OWNERSHIP_MOVED_LOG, args.notificationId);
			return null;
		}

		// If all sends failed, reschedule for retry (up to MAX_RETRY_COUNT attempts)
		if (sentCount === 0 && !notification.hadEnqueue) {
			const currentRetry = notification.retryCount;
			if (currentRetry >= MAX_RETRY_COUNT) {
				console.error(
					`[sendPendingAdminNotification] All ${targetEmails.length} email sends failed for thread ${notification.threadId} after ${currentRetry} retries, giving up`
				);
				const deleted = await ctx.runMutation(
					internal.admin.support.notifications.deletePendingNotification,
					{
						notificationId: args.notificationId,
						claimToken: notification.claimToken
					}
				);
				if (!deleted) console.log(OWNERSHIP_MOVED_LOG, args.notificationId);
				return null;
			}

			console.error(
				`[sendPendingAdminNotification] All ${targetEmails.length} email sends failed for thread ${notification.threadId}, retry ${currentRetry + 1}/${MAX_RETRY_COUNT}...`
			);
			// Reschedule with 1 minute delay via mutation (for guaranteed delivery semantics)
			const rescheduled = await ctx.runMutation(
				internal.admin.support.notifications.reschedulePendingNotification,
				{
					notificationId: args.notificationId,
					claimToken: notification.claimToken,
					delayMs: 60_000 // 1 minute retry delay
				}
			);
			if (!rescheduled) console.log(OWNERSHIP_MOVED_LOG, args.notificationId);
			return null;
		}

		// Clean up the pending notification
		const deleted = await ctx.runMutation(
			internal.admin.support.notifications.deletePendingNotification,
			{
				notificationId: args.notificationId,
				claimToken: notification.claimToken
			}
		);
		if (!deleted) console.log(OWNERSHIP_MOVED_LOG, args.notificationId);

		console.log(
			`[sendPendingAdminNotification] Sent ${notification.isReopen ? 'reopen' : 'new ticket'} notification for thread ${notification.threadId} to ${sentCount}/${targetEmails.length} recipient(s)`
		);
		return null;
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
 * - pending (scheduledFnId set) → claimed (scheduledFnId cleared, claimToken
 *   written) → deleted
 *
 * The claim token tells two sends apart when the row is re-armed and claimed
 * again before an earlier send finishes: both see an unscheduled row, but only
 * the newest claim holds the token on it.
 *
 * Only a caller that asks for a token is granted a claim. An action that started
 * before this protocol was deployed claims without asking and cleans up without
 * a token, so a tokened claim would strand its row unscheduled and a tokenless
 * one could be deleted by another such send. That caller gets no claim: the row
 * is handed to a fresh send, which claims it with a token.
 *
 * @param args.notificationId - The notification to claim
 * @param args.issueToken - Set by callers that pass the returned token to every cleanup
 * @returns The notification data and claim token if claimed, null if already
 *   claimed, handed off, or not found
 */
export const claimNotificationForSending = internalMutation({
	args: {
		notificationId: v.id('pendingAdminNotifications'),
		issueToken: v.optional(v.boolean()),
		receiptProtocol: v.optional(v.literal(1))
	},
	returns: v.union(
		v.object({
			threadId: v.string(),
			messageIds: v.array(v.string()),
			isReopen: v.boolean(),
			notificationType: v.union(v.literal('newTickets'), v.literal('userReplies')),
			retryCount: v.number(),
			claimToken: v.string(),
			generation: v.string(),
			hadEnqueue: v.boolean()
		}),
		v.null()
	),
	handler: async (ctx, args) => {
		const notification = await ctx.db.get('pendingAdminNotifications', args.notificationId);

		// Not found or already claimed (scheduledFnId is undefined when claimed)
		if (!notification || notification.scheduledFnId === undefined) {
			return null;
		}

		// A caller without token support cannot hold a claim safely, so a new send
		// takes the row over right away
		if (args.issueToken !== true || args.receiptProtocol !== 1) {
			const handoffFnId = await ctx.scheduler.runAfter(
				0,
				internal.admin.support.notifications.sendPendingAdminNotification,
				{ notificationId: args.notificationId }
			);
			await ctx.db.patch('pendingAdminNotifications', args.notificationId, {
				scheduledFnId: handoffFnId
			});
			return null;
		}

		// Clear scheduledFnId and write a fresh token to claim ownership atomically
		// This prevents other actions from claiming this notification, and an older
		// send from cleaning up after this claim
		const claimToken = crypto.randomUUID();
		const generation = notification.generation ?? crypto.randomUUID();
		const claimLeaseExpiresAt = Date.now() + CLAIM_LEASE_MS;
		const recoveryFnId = await ctx.scheduler.runAt(
			claimLeaseExpiresAt,
			internal.admin.support.notifications.recoverNotificationClaim,
			{ notificationId: args.notificationId, generation, claimToken, deadline: claimLeaseExpiresAt }
		);
		const hadEnqueue =
			(await ctx.db
				.query('supportNotificationReceipts')
				.withIndex('by_notificationId_and_generation_and_email', (q) =>
					q.eq('notificationId', args.notificationId).eq('generation', generation)
				)
				.first()) !== null;
		await ctx.db.patch('pendingAdminNotifications', args.notificationId, {
			scheduledFnId: undefined,
			claimToken,
			generation,
			claimLeaseExpiresAt,
			recoveryFnId
		});

		return {
			threadId: notification.threadId,
			messageIds: notification.messageIds,
			isReopen: notification.isReopen,
			notificationType: notification.notificationType,
			retryCount: notification.retryCount ?? 0,
			claimToken,
			generation,
			hadEnqueue
		};
	}
});

/**
 * Get support thread data for notification
 */
export const getSupportThread = internalQuery({
	args: {
		threadId: v.string()
	},
	returns: v.union(
		v.object({
			_id: v.id('supportThreads'),
			_creationTime: v.number(),
			...supportThreadFields
		}),
		v.null()
	),
	handler: async (ctx, args) => {
		return await ctx.db
			.query('supportThreads')
			.withIndex('by_thread', (q) => q.eq('threadId', args.threadId))
			.first();
	}
});

/**
 * Whether the send that presents `claimToken` still owns a pending notification
 *
 * A send owns its row only while the row is unscheduled and carries the token
 * claimNotificationForSending issued to that send. A scheduledFnId means the row
 * was re-armed or rescheduled and a newer job owns it; a different token means a
 * newer send has claimed it since. Only a claim made before tokens existed
 * matches a missing token, because every new claim writes one.
 */
function isOwnedByClaim(
	notification: Doc<'pendingAdminNotifications'>,
	claimToken: string | undefined
): boolean {
	return notification.scheduledFnId === undefined && notification.claimToken === claimToken;
}

/**
 * Delete a pending notification that the running send still owns
 *
 * Any other owner holds messages this send did not deliver: the row was re-armed
 * with additional messages while this send was running, and possibly claimed
 * again by the newer send, so deleting it would drop those messages.
 *
 * @param args.notificationId - The notification to delete
 * @param args.claimToken - The token returned by this send's claim
 * @returns true if deleted, false if not found or owned by a newer send
 */
export const deletePendingNotification = internalMutation({
	args: {
		notificationId: v.id('pendingAdminNotifications'),
		claimToken: v.optional(v.string())
	},
	returns: v.boolean(),
	handler: async (ctx, args) => {
		const notification = await ctx.db.get('pendingAdminNotifications', args.notificationId);

		// Not found - already deleted
		if (!notification) {
			return false;
		}

		// Re-armed or claimed again while the send was running, so a newer send owns the row
		if (!isOwnedByClaim(notification, args.claimToken)) {
			return false;
		}

		await finishNotification(ctx, notification);
		return true;
	}
});

/**
 * Reschedule a pending notification for retry
 *
 * Called when all email sends fail to ensure the notification is retried later.
 * Updates the scheduledFnId to point to the new scheduled function.
 *
 * Only the send that owns the row may retry it. A row re-armed during the failed
 * sends already carries a newer job for the same messages, and a row claimed
 * again belongs to the newer send, so either is left alone. The retry clears the
 * claim token, which ends this send's ownership.
 *
 * @param args.notificationId - The notification to reschedule
 * @param args.claimToken - The token returned by this send's claim
 * @param args.delayMs - Delay in milliseconds before retry (default 60 seconds)
 * @returns true if rescheduled, false if not found or owned by a newer send
 */
export const reschedulePendingNotification = internalMutation({
	args: {
		notificationId: v.id('pendingAdminNotifications'),
		claimToken: v.optional(v.string()),
		delayMs: v.optional(v.number())
	},
	returns: v.boolean(),
	handler: async (ctx, args) => {
		const notification = await ctx.db.get('pendingAdminNotifications', args.notificationId);

		if (!notification) {
			return false;
		}

		// Re-armed or claimed again while the send was running, so a newer send owns the retry
		if (!isOwnedByClaim(notification, args.claimToken)) {
			return false;
		}

		const delayMs = args.delayMs ?? 60_000; // Default 1 minute
		const nextRetryCount = (notification.retryCount ?? 0) + 1;
		if (nextRetryCount > MAX_RETRY_COUNT) return false;
		await cancelRecovery(ctx, notification);

		// Schedule new send attempt
		const newScheduledFnId = await ctx.scheduler.runAfter(
			delayMs,
			internal.admin.support.notifications.sendPendingAdminNotification,
			{ notificationId: args.notificationId }
		);

		// Update notification with new scheduled function ID and incremented retry count
		await ctx.db.patch('pendingAdminNotifications', args.notificationId, {
			scheduledFor: Date.now() + delayMs,
			scheduledFnId: newScheduledFnId,
			claimToken: undefined,
			claimLeaseExpiresAt: undefined,
			recoveryFnId: undefined,
			retryCount: nextRetryCount
		});

		console.log(
			`[reschedulePendingNotification] Rescheduled notification for thread ${notification.threadId} with ${delayMs}ms delay (retry ${nextRetryCount}/${MAX_RETRY_COUNT})`
		);

		return true;
	}
});

export const recoverNotificationClaim = internalMutation({
	args: {
		notificationId: v.id('pendingAdminNotifications'),
		generation: v.string(),
		claimToken: v.string(),
		deadline: v.number()
	},
	returns: v.boolean(),
	handler: async (ctx, args): Promise<boolean> => {
		const notification = await ctx.db.get('pendingAdminNotifications', args.notificationId);
		if (
			!notification ||
			notification.generation !== args.generation ||
			!isOwnedByClaim(notification, args.claimToken) ||
			notification.claimLeaseExpiresAt !== args.deadline ||
			Date.now() < args.deadline
		)
			return false;
		if ((notification.retryCount ?? 0) >= MAX_RETRY_COUNT) {
			console.error(
				'[recoverNotificationClaim] Retry limit reached; abandoned notification stopped'
			);
			await finishNotification(ctx, notification);
			return true;
		}
		return await ctx.runMutation(
			internal.admin.support.notifications.reschedulePendingNotification,
			{ notificationId: args.notificationId, claimToken: args.claimToken, delayMs: 60_000 }
		);
	}
});

export const listLegacyNotificationClaims = internalQuery({
	args: { paginationOpts: paginationOptsValidator },
	returns: v.object({
		page: v.array(v.id('pendingAdminNotifications')),
		continueCursor: v.string(),
		isDone: v.boolean()
	}),
	handler: async (ctx, args) => {
		const result = await ctx.db.query('pendingAdminNotifications').paginate({
			...args.paginationOpts,
			numItems: Math.min(100, args.paginationOpts.numItems),
			maximumBytesRead: 512 * 1024
		});
		// Missing receipts cannot establish whether an older sender already delivered.
		return {
			continueCursor: result.continueCursor,
			isDone: result.isDone,
			page: result.page
				.filter((row) => row.scheduledFnId === undefined && row.generation === undefined)
				.map((row) => row._id)
		};
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
		// eslint-disable-next-line @convex-dev/no-collect-in-query -- Bounded: rows exist only through admin actions (promotions, custom recipients), one per email
		const allPrefs = await ctx.db.query('adminNotificationPreferences').collect();

		// Filter to active recipients (admins or custom emails) with this notification enabled
		const activePrefs = allPrefs.filter((p) => receivesNotification(p, args.notificationType));

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
			messageIds: args.messageIds as Array<Id<'messages'>>
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
		await finishNotification(ctx, pending);
		return true;
	}
});
