/**
 * Debounced admin emails for support threads.
 *
 * A handoff, a reopen, or a user message on a handed-off thread schedules one
 * pending notification per thread. Each further message restarts
 * NOTIFICATION_DELAY_MS, capped at MAX_DEBOUNCE_AGE_MS after the first trigger,
 * so one email carries the accumulated messages. Recipients come from the
 * adminNotificationPreferences table.
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

const NOTIFICATION_DELAY_MS = 4 * 60 * 1000;

/**
 * Latest send time after a pending notification's createdAt. Without it, a
 * customer who writes more often than NOTIFICATION_DELAY_MS keeps pushing the
 * send back and no admin is ever alerted.
 */
const MAX_DEBOUNCE_AGE_MS = 15 * 60 * 1000;

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

const OWNERSHIP_MOVED_LOG =
	'[sendPendingAdminNotification] Pending notification no longer owned by this send; row was re-armed, claimed by a newer send, or cancelled, skipping cleanup:';

/**
 * Schedules or extends the pending admin notification for a support thread.
 *
 * A handoff or a reopen passes `newTickets`. A message on a handed-off thread
 * passes `userReplies`. `notificationType` selects the preference toggle that
 * picks recipients.
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

		// An empty messageIds (a bare "Talk to a human") still notifies admins. The
		// email then renders a fallback line instead of message excerpts.
		const now = Date.now();

		const existing = await ctx.db
			.query('pendingAdminNotifications')
			.withIndex('by_thread', (q) => q.eq('threadId', args.threadId))
			.first();

		if (existing) {
			await cancelRecovery(ctx, existing);
			// A row without a scheduled function is claimed by a running send. Once
			// that send has enqueued a recipient, re-arming starts a fresh window, so a
			// row past its cap does not repeat those messages seconds later. Before
			// that, re-arming evicts the send before it emails anyone, so the row keeps
			// its cap. A claim without a generation predates receipts, so a missing
			// receipt proves nothing there and it keeps the fresh window.
			const claimedBySend = existing.scheduledFnId === undefined;
			const generation = existing.generation;
			const emailedBySend =
				claimedBySend &&
				(generation === undefined ||
					(await ctx.db
						.query('supportNotificationReceipts')
						.withIndex('by_notificationId_and_generation_and_email', (q) =>
							q.eq('notificationId', existing._id).eq('generation', generation)
						)
						.first()) !== null);

			// Otherwise each message restarts the delay, but never past the cap from
			// the row's creation, and never earlier than the current deadline, so a
			// message cannot cut short a retry's backoff. The floor at now keeps a
			// passed cap from a negative delay, which runAfter rejects.
			const scheduledFor = emailedBySend
				? now + NOTIFICATION_DELAY_MS
				: Math.max(
						now,
						existing.scheduledFor,
						Math.min(now + NOTIFICATION_DELAY_MS, existing.createdAt + MAX_DEBOUNCE_AGE_MS)
					);

			if (existing.scheduledFnId) {
				const scheduledFn = await ctx.db.system.get(existing.scheduledFnId);
				if (scheduledFn?.state.kind === 'pending') {
					await ctx.scheduler.cancel(existing.scheduledFnId);
				}
			}

			const existingSet = new Set(existing.messageIds);
			const newMessageIds = args.messageIds.filter((id) => !existingSet.has(id));
			const updatedMessageIds = [...existing.messageIds, ...newMessageIds];

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
				// The fresh window after a send that emailed gets its own cap
				...(emailedBySend ? { createdAt: now } : {}),
				scheduledFnId: newScheduledFnId,
				claimToken: undefined,
				generation: crypto.randomUUID(),
				claimLeaseExpiresAt: undefined,
				recoveryFnId: undefined,
				isReopen: existing.isReopen || args.isReopen,
				// 'newTickets' wins because it is the primary event
				notificationType:
					existing.notificationType === 'newTickets' ? 'newTickets' : args.notificationType
			});
		} else {
			const notificationId = await ctx.db.insert('pendingAdminNotifications', {
				threadId: args.threadId,
				isReopen: args.isReopen,
				notificationType: args.notificationType,
				scheduledFor: now + NOTIFICATION_DELAY_MS,
				messageIds: args.messageIds,
				generation: crypto.randomUUID(),
				createdAt: now
			});

			const scheduledFnId = await ctx.scheduler.runAfter(
				NOTIFICATION_DELAY_MS,
				internal.admin.support.notifications.sendPendingAdminNotification,
				{
					notificationId
				}
			);

			await ctx.db.patch('pendingAdminNotifications', notificationId, {
				scheduledFnId
			});
		}

		return null;
	}
});

/**
 * Sends the accumulated messages of a pending notification to its recipients.
 *
 * Ownership protocol: the claim clears scheduledFnId and writes a fresh claim
 * token. Every later mutation of this action passes that token and touches the
 * row only while it is still unscheduled and carries the same token. Email sends
 * take seconds outside any transaction, so a customer message can re-arm the
 * row in that window and take ownership back. The re-armed send may claim the
 * row before this one finishes. Its new token keeps this send from deleting or
 * retrying that claim, and the newer send delivers the accumulated messages.
 */
export const sendPendingAdminNotification = internalAction({
	args: {
		notificationId: v.id('pendingAdminNotifications')
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const notification = await ctx.runMutation(
			internal.admin.support.notifications.claimNotificationForSending,
			{
				notificationId: args.notificationId,
				issueToken: true,
				receiptProtocol: 1
			}
		);

		if (!notification) {
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

		// E2E test addresses never receive email. Dropping them here keeps them from
		// counting as a delivery and keeps an all-test notification from retrying.
		const targetEmails = (
			await ctx.runQuery(internal.admin.support.notifications.getNotificationTargetEmails, {
				assignedTo: supportThread.assignedTo,
				notificationType: notification.notificationType
			})
		).filter((email) => !shouldSkipTestEmail('sendPendingAdminNotification', email));

		if (targetEmails.length === 0) {
			console.log('[sendPendingAdminNotification] No target emails found, skipping notification');
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

		const messages = await ctx.runQuery(internal.admin.support.notifications.getMessageContents, {
			messageIds: notification.messageIds
		});

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
						// A handoff without messages is a bare "Talk to a human". Its empty-state
						// line names the handoff instead of the neutral "no messages" line.
						isBareHandoff: notification.messageIds.length === 0,
						userName: supportThread.userName || 'Anonymous',
						messages,
						threadId: notification.threadId
					}
				);
				if (enqueued) sentCount++;
			} catch {
				console.error({
					code: 'admin_notification_send_failed',
					threadId: notification.threadId
				});
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
			// The retry is scheduled from a mutation for its guaranteed delivery semantics
			const rescheduled = await ctx.runMutation(
				internal.admin.support.notifications.reschedulePendingNotification,
				{
					notificationId: args.notificationId,
					claimToken: notification.claimToken,
					delayMs: 60_000
				}
			);
			if (!rescheduled) console.log(OWNERSHIP_MOVED_LOG, args.notificationId);
			return null;
		}

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

/**
 * Claims a pending notification for one send.
 *
 * The claim clears scheduledFnId, so no other action can claim the row, and
 * writes a claim token. The token tells two sends apart when the row is re-armed
 * and claimed again before an earlier send finishes: both see an unscheduled
 * row, but only the newest claim holds the token on it.
 *
 * Only a caller that asks for a token is granted a claim. An action that started
 * before this protocol was deployed claims without asking and cleans up without
 * a token. A tokened claim would strand its row unscheduled, and a tokenless one
 * could be deleted by another such send. That caller gets no claim, and the row
 * is handed to a fresh send, which claims it with a token.
 *
 * @param args.issueToken - Set by callers that pass the returned token to every cleanup
 * @returns The notification and claim token, or null when the row is missing,
 *   already claimed, or handed off
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

		if (!notification || notification.scheduledFnId === undefined) {
			return null;
		}

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
 * Whether the send that presents `claimToken` still owns a pending notification.
 *
 * A send owns its row only while the row is unscheduled and carries the token
 * claimNotificationForSending issued to that send. A scheduledFnId means a newer
 * job owns the re-armed or rescheduled row. A different token means a newer send
 * has claimed it. Only a claim made before tokens existed matches a missing
 * token, because every new claim writes one.
 */
function isOwnedByClaim(
	notification: Doc<'pendingAdminNotifications'>,
	claimToken: string | undefined
): boolean {
	return notification.scheduledFnId === undefined && notification.claimToken === claimToken;
}

/**
 * Deletes a pending notification that the running send still owns.
 *
 * Any other owner holds messages this send did not deliver: the row was re-armed
 * with additional messages while this send was running. Deleting it would drop
 * those messages.
 *
 * @param args.claimToken - The token returned by this send's claim
 * @returns false when the row is missing or owned by a newer send
 */
export const deletePendingNotification = internalMutation({
	args: {
		notificationId: v.id('pendingAdminNotifications'),
		claimToken: v.optional(v.string())
	},
	returns: v.boolean(),
	handler: async (ctx, args) => {
		const notification = await ctx.db.get('pendingAdminNotifications', args.notificationId);

		if (!notification) {
			return false;
		}

		if (!isOwnedByClaim(notification, args.claimToken)) {
			return false;
		}

		await finishNotification(ctx, notification);
		return true;
	}
});

/**
 * Schedules a retry for a pending notification whose sends all failed.
 *
 * Only the send that owns the row may retry it. A row re-armed during the failed
 * sends already carries a newer job for the same messages. A row claimed again
 * belongs to the newer send. The retry clears the claim token, which ends this
 * send's ownership.
 *
 * @param args.claimToken - The token returned by this send's claim
 * @returns false when the row is missing, owned by a newer send, or out of retries
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

		if (!isOwnedByClaim(notification, args.claimToken)) {
			return false;
		}

		const delayMs = args.delayMs ?? 60_000;
		const nextRetryCount = (notification.retryCount ?? 0) + 1;
		if (nextRetryCount > MAX_RETRY_COUNT) return false;
		await cancelRecovery(ctx, notification);

		const newScheduledFnId = await ctx.scheduler.runAfter(
			delayMs,
			internal.admin.support.notifications.sendPendingAdminNotification,
			{ notificationId: args.notificationId }
		);

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
 * Returns the recipients of a notification type from adminNotificationPreferences.
 *
 * An assigned admin with the type enabled is the only recipient. Otherwise every
 * recipient with the type enabled, admin or custom email, receives it.
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

		const activePrefs = allPrefs.filter((p) => receivesNotification(p, args.notificationType));

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
 * Formats messages from the agent component for the email.
 *
 * Each message is cut to 500 characters to keep the email small.
 */
export const getMessageContents = internalQuery({
	args: {
		messageIds: v.array(v.string())
	},
	returns: v.array(v.object({ text: v.string(), timestamp: v.string() })),
	handler: async (ctx, args) => {
		const messages: Array<{ text: string; timestamp: string }> = [];

		// messageIds are stored as strings, and the agent component expects typed IDs
		const messagesResult = await ctx.runQuery(components.agent.messages.getMessagesByIds, {
			messageIds: args.messageIds as Array<Id<'messages'>>
		});

		for (const message of messagesResult) {
			if (message?.text) {
				const date = new Date(message._creationTime);
				const timestamp = date.toLocaleString('en-US', {
					month: 'short',
					day: 'numeric',
					hour: 'numeric',
					minute: '2-digit',
					hour12: true
				});

				messages.push({
					text: message.text.slice(0, 500),
					timestamp
				});
			}
		}

		return messages;
	}
});

/**
 * Returns the IDs of a thread's recent user messages in chronological order.
 *
 * The first notification of a thread that reaches the team includes them.
 * Assistant messages and the "Talk to support" message are left out.
 */
export const getRecentUserMessages = internalQuery({
	args: {
		threadId: v.string(),
		limit: v.optional(v.number())
	},
	returns: v.array(v.string()),
	handler: async (ctx, args) => {
		const maxMessages = args.limit ?? 10;

		const result = await ctx.runQuery(components.agent.messages.listMessagesByThreadId, {
			threadId: args.threadId,
			order: 'desc',
			statuses: ['success'],
			paginationOpts: { numItems: 50, cursor: null }
		});

		const userMessages = result.page.filter((msg) => {
			if (msg.message?.role !== 'user') return false;

			const text =
				typeof msg.message.content === 'string'
					? msg.message.content
					: Array.isArray(msg.message.content)
						? msg.message.content
								.filter((p): p is { type: 'text'; text: string } => p.type === 'text')
								.map((p) => p.text)
								.join(' ')
						: '';

			if (text.toLowerCase().trim() === 'talk to support') return false;

			return true;
		});

		const recentMessages = userMessages.slice(0, maxMessages).reverse();

		return recentMessages.map((msg) => msg._id);
	}
});

/**
 * Cancels a thread's pending notification when the ticket is closed or assigned
 * before the email goes out.
 *
 * @returns false when the thread has no pending notification
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

		if (pending.scheduledFnId) {
			const scheduledFn = await ctx.db.system.get(pending.scheduledFnId);
			if (scheduledFn?.state.kind === 'pending') {
				await ctx.scheduler.cancel(pending.scheduledFnId);
			}
		}

		await finishNotification(ctx, pending);
		return true;
	}
});
