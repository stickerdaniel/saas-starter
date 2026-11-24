/**
 * Debounced admin emails for support threads.
 *
 * A handoff, a reopen, or a user message on a handed-off thread schedules one
 * pending notification per thread. Each further message restarts
 * NOTIFICATION_DELAY_MS, capped at MAX_DEBOUNCE_AGE_MS after the first trigger,
 * so one email carries the accumulated messages. Recipients come from the
 * adminNotificationPreferences table.
 */

import { FunctionImpl, GroupImpl } from '@confect/server';
import * as DateTime from 'effect/DateTime';
import * as Duration from 'effect/Duration';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import { components, internal } from '../../../convex/_generated/api';
import type { Doc, Id } from '../../../convex/_generated/dataModel';
import type {
	MutationCtx as ConvexMutationCtx,
	QueryCtx as ConvexQueryCtx
} from '../../../convex/_generated/server';
import refs from '../../_generated/refs';
import databaseSchema from '../../_generated/schema';
import {
	MutationCtx,
	MutationRunner,
	QueryCtx,
	QueryRunner,
	Scheduler
} from '../../_generated/services';
import { shouldSkipTestEmail } from '../../emails/helpers';
import { getEmailDeliveryConfiguration } from '../../emails/resend';
import { receivesNotification } from '../notificationPreferences/queries';
import notifications from './notifications.spec';
import type {
	LegacyClaimsArgsSchema,
	MessageContentsArgsSchema,
	NotificationClaimArgsSchema,
	NotificationClaimSchema,
	NotificationOwnershipArgsSchema,
	NotificationRecoveryArgsSchema,
	NotificationRescheduleArgsSchema,
	NotificationScheduleArgsSchema,
	NotificationSendArgsSchema,
	RecentUserMessagesArgsSchema,
	TargetEmailsArgsSchema
} from './schemas';

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

type PendingNotification = Doc<'pendingAdminNotifications'>;
type SchedulingEffect<A> = Effect.Effect<A, never, MutationCtx | Scheduler>;

const withMutation = <A>(run: (ctx: ConvexMutationCtx) => Promise<A>) =>
	MutationCtx.use((ctx) => Effect.promise(() => run(ctx)));

const withQuery = <A>(run: (ctx: ConvexQueryCtx) => Promise<A>) =>
	QueryCtx.use((ctx) => Effect.promise(() => run(ctx)));

const isPending = (scheduledFnId: Id<'_scheduled_functions'>) =>
	withMutation(async (ctx) => (await ctx.db.system.get(scheduledFnId))?.state.kind === 'pending');

const cancelRecovery = (notification: PendingNotification): SchedulingEffect<void> =>
	Effect.gen(function* () {
		if (notification.recoveryFnId && (yield* isPending(notification.recoveryFnId)))
			yield* (yield* Scheduler).cancel(notification.recoveryFnId);
	});

const finishNotification = (notification: PendingNotification): SchedulingEffect<void> =>
	Effect.gen(function* () {
		yield* cancelRecovery(notification);
		const hasReceipts = yield* withMutation(async (ctx) => {
			await ctx.db.delete('pendingAdminNotifications', notification._id);
			return (
				(await ctx.db
					.query('supportNotificationReceipts')
					.withIndex('by_notificationId_and_generation_and_email', (q) =>
						q.eq('notificationId', notification._id)
					)
					.first()) !== null
			);
		});
		if (hasReceipts)
			yield* (yield* Scheduler).runAfter(
				Duration.zero,
				refs.internal.admin.support.notificationDelivery.cleanupReceipts,
				{ notificationId: notification._id, cursor: null }
			);
	});

const scheduleSend = (
	delayMs: number,
	notificationId: Id<'pendingAdminNotifications'>
): SchedulingEffect<Id<'_scheduled_functions'>> =>
	Effect.gen(function* () {
		return yield* (yield* Scheduler).runAfter(
			Duration.millis(delayMs),
			refs.internal.admin.support.notifications.sendPendingAdminNotification,
			{ notificationId }
		);
	});

const OWNERSHIP_MOVED_LOG =
	'[sendPendingAdminNotification] Pending notification no longer owned by this send; row was re-armed, claimed by a newer send, or cancelled, skipping cleanup:';

/**
 * Schedules or extends the pending admin notification for a support thread.
 *
 * A handoff or a reopen passes `newTickets`. A message on a handed-off thread
 * passes `userReplies`. `notificationType` selects the preference toggle that
 * picks recipients.
 */
const scheduleAdminNotification = (
	args: typeof NotificationScheduleArgsSchema.Type
): SchedulingEffect<null> =>
	Effect.gen(function* () {
		if (getEmailDeliveryConfiguration().state !== 'ready') return null;

		// An empty messageIds (a bare "Talk to a human") still notifies admins. The
		// email then renders a fallback line instead of message excerpts.
		const now = Date.now();

		const existing = yield* withMutation((ctx) =>
			ctx.db
				.query('pendingAdminNotifications')
				.withIndex('by_thread', (q) => q.eq('threadId', args.threadId))
				.first()
		);

		if (existing) {
			yield* cancelRecovery(existing);
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
					(yield* withMutation((ctx) =>
						ctx.db
							.query('supportNotificationReceipts')
							.withIndex('by_notificationId_and_generation_and_email', (q) =>
								q.eq('notificationId', existing._id).eq('generation', generation)
							)
							.first()
					)) !== null);

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

			if (existing.scheduledFnId && (yield* isPending(existing.scheduledFnId))) {
				yield* (yield* Scheduler).cancel(existing.scheduledFnId);
			}

			const existingSet = new Set(existing.messageIds);
			const newMessageIds = args.messageIds.filter((id) => !existingSet.has(id));
			const updatedMessageIds = [...existing.messageIds, ...newMessageIds];

			const newScheduledFnId = yield* scheduleSend(scheduledFor - now, existing._id);

			// Writing scheduledFnId and clearing claimToken also evicts an in-flight
			// sender: a send owns the row only while it is unscheduled and still carries
			// that send's claim token, so this patch hands ownership to the new job.
			yield* withMutation((ctx) =>
				ctx.db.patch('pendingAdminNotifications', existing._id, {
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
				})
			);
		} else {
			const notificationId = yield* withMutation((ctx) =>
				ctx.db.insert('pendingAdminNotifications', {
					threadId: args.threadId,
					isReopen: args.isReopen,
					notificationType: args.notificationType,
					scheduledFor: now + NOTIFICATION_DELAY_MS,
					messageIds: args.messageIds,
					generation: crypto.randomUUID(),
					createdAt: now
				})
			);

			const scheduledFnId = yield* scheduleSend(NOTIFICATION_DELAY_MS, notificationId);

			yield* withMutation((ctx) =>
				ctx.db.patch('pendingAdminNotifications', notificationId, { scheduledFnId })
			);
		}

		return null;
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
const sendPendingAdminNotification = ({
	notificationId
}: typeof NotificationSendArgsSchema.Type): Effect.Effect<
	null,
	never,
	QueryRunner | MutationRunner
> =>
	Effect.gen(function* () {
		const queries = yield* QueryRunner;
		const mutations = yield* MutationRunner;

		const notification = yield* mutations
			.runMutation(refs.internal.admin.support.notifications.claimNotificationForSending, {
				notificationId,
				issueToken: true,
				receiptProtocol: 1
			})
			.pipe(Effect.orDie);

		if (!notification) {
			yield* Effect.sync(() =>
				console.log(
					`[sendPendingAdminNotification] Notification ${notificationId} not claimable (already claimed or rescheduled), skipping`
				)
			);
			return null;
		}

		const ownership = { notificationId, claimToken: notification.claimToken };
		const logIfMoved = (owned: boolean) =>
			owned ? Effect.void : Effect.sync(() => console.log(OWNERSHIP_MOVED_LOG, notificationId));
		const finish = mutations
			.runMutation(refs.internal.admin.support.notifications.deletePendingNotification, ownership)
			.pipe(Effect.orDie, Effect.flatMap(logIfMoved));

		if (getEmailDeliveryConfiguration().state !== 'ready') {
			yield* finish;
			return null;
		}

		const supportThread = yield* queries
			.runQuery(refs.internal.admin.support.notifications.getSupportThread, {
				threadId: notification.threadId
			})
			.pipe(Effect.orDie);

		if (!supportThread) {
			yield* Effect.sync(() =>
				console.log(
					`[sendPendingAdminNotification] Thread ${notification.threadId} not found, skipping`
				)
			);
			yield* finish;
			return null;
		}

		// E2E test addresses never receive email. Dropping them here keeps them from
		// counting as a delivery and keeps an all-test notification from retrying.
		const targetEmails = (yield* queries
			.runQuery(refs.internal.admin.support.notifications.getNotificationTargetEmails, {
				assignedTo: supportThread.assignedTo,
				notificationType: notification.notificationType
			})
			.pipe(Effect.orDie)).filter(
			(email) => !shouldSkipTestEmail('sendPendingAdminNotification', email)
		);

		if (targetEmails.length === 0) {
			yield* Effect.sync(() =>
				console.log('[sendPendingAdminNotification] No target emails found, skipping notification')
			);
			yield* finish;
			return null;
		}

		const messages = yield* queries
			.runQuery(refs.internal.admin.support.notifications.getMessageContents, {
				messageIds: notification.messageIds
			})
			.pipe(Effect.orDie);

		let sentCount = 0;
		for (const email of targetEmails) {
			const enqueued = yield* mutations
				.runMutation(refs.internal.admin.support.notificationDelivery.enqueueRecipient, {
					notificationId,
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
				})
				.pipe(
					Effect.catchCause(() =>
						Effect.sync(() => {
							console.error({
								code: 'admin_notification_send_failed',
								threadId: notification.threadId
							});
							return false;
						})
					)
				);
			if (enqueued) sentCount++;
		}

		// If configuration changed while recipient sends were running, finish the
		// claimed row instead of retrying work that cannot reach the provider.
		if (sentCount === 0 && getEmailDeliveryConfiguration().state !== 'ready') {
			yield* finish;
			return null;
		}

		if (sentCount === 0 && !notification.hadEnqueue) {
			const currentRetry = notification.retryCount;
			if (currentRetry >= MAX_RETRY_COUNT) {
				yield* Effect.sync(() =>
					console.error(
						`[sendPendingAdminNotification] All ${targetEmails.length} email sends failed for thread ${notification.threadId} after ${currentRetry} retries, giving up`
					)
				);
				yield* finish;
				return null;
			}

			yield* Effect.sync(() =>
				console.error(
					`[sendPendingAdminNotification] All ${targetEmails.length} email sends failed for thread ${notification.threadId}, retry ${currentRetry + 1}/${MAX_RETRY_COUNT}...`
				)
			);
			// The retry is scheduled from a mutation for its guaranteed delivery semantics
			yield* mutations
				.runMutation(refs.internal.admin.support.notifications.reschedulePendingNotification, {
					...ownership,
					delayMs: 60_000
				})
				.pipe(Effect.orDie, Effect.flatMap(logIfMoved));
			return null;
		}

		yield* finish;

		yield* Effect.sync(() =>
			console.log(
				`[sendPendingAdminNotification] Sent ${notification.isReopen ? 'reopen' : 'new ticket'} notification for thread ${notification.threadId} to ${sentCount}/${targetEmails.length} recipient(s)`
			)
		);
		return null;
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
 */
const claimNotificationForSending = (
	args: typeof NotificationClaimArgsSchema.Type
): SchedulingEffect<typeof NotificationClaimSchema.Type> =>
	Effect.gen(function* () {
		const notification = yield* withMutation((ctx) =>
			ctx.db.get('pendingAdminNotifications', args.notificationId)
		);

		if (!notification || notification.scheduledFnId === undefined) {
			return null;
		}

		if (args.issueToken !== true || args.receiptProtocol !== 1) {
			const handoffFnId = yield* scheduleSend(0, args.notificationId);
			yield* withMutation((ctx) =>
				ctx.db.patch('pendingAdminNotifications', args.notificationId, {
					scheduledFnId: handoffFnId
				})
			);
			return null;
		}

		const claimToken = crypto.randomUUID();
		const generation = notification.generation ?? crypto.randomUUID();
		const claimLeaseExpiresAt = Date.now() + CLAIM_LEASE_MS;
		const recoveryFnId = yield* (yield* Scheduler).runAt(
			DateTime.makeUnsafe(claimLeaseExpiresAt),
			refs.internal.admin.support.notifications.recoverNotificationClaim,
			{ notificationId: args.notificationId, generation, claimToken, deadline: claimLeaseExpiresAt }
		);
		const hadEnqueue = yield* withMutation(
			async (ctx) =>
				(await ctx.db
					.query('supportNotificationReceipts')
					.withIndex('by_notificationId_and_generation_and_email', (q) =>
						q.eq('notificationId', args.notificationId).eq('generation', generation)
					)
					.first()) !== null
		);
		yield* withMutation((ctx) =>
			ctx.db.patch('pendingAdminNotifications', args.notificationId, {
				scheduledFnId: undefined,
				claimToken,
				generation,
				claimLeaseExpiresAt,
				recoveryFnId
			})
		);

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
function isOwnedByClaim(notification: PendingNotification, claimToken: string | undefined) {
	return notification.scheduledFnId === undefined && notification.claimToken === claimToken;
}

/**
 * Deletes a pending notification that the running send still owns.
 *
 * Any other owner holds messages this send did not deliver: the row was re-armed
 * with additional messages while this send was running. Deleting it would drop
 * those messages.
 */
const deletePendingNotification = (
	args: typeof NotificationOwnershipArgsSchema.Type
): SchedulingEffect<boolean> =>
	Effect.gen(function* () {
		const notification = yield* withMutation((ctx) =>
			ctx.db.get('pendingAdminNotifications', args.notificationId)
		);
		if (!notification || !isOwnedByClaim(notification, args.claimToken)) return false;
		yield* finishNotification(notification);
		return true;
	});

/**
 * Schedules a retry for a pending notification whose sends all failed.
 *
 * Only the send that owns the row may retry it. A row re-armed during the failed
 * sends already carries a newer job for the same messages. A row claimed again
 * belongs to the newer send. The retry clears the claim token, which ends this
 * send's ownership.
 */
const reschedulePendingNotification = (
	args: typeof NotificationRescheduleArgsSchema.Type
): SchedulingEffect<boolean> =>
	Effect.gen(function* () {
		const notification = yield* withMutation((ctx) =>
			ctx.db.get('pendingAdminNotifications', args.notificationId)
		);
		if (!notification || !isOwnedByClaim(notification, args.claimToken)) return false;

		const delayMs = args.delayMs ?? 60_000;
		const nextRetryCount = (notification.retryCount ?? 0) + 1;
		if (nextRetryCount > MAX_RETRY_COUNT) return false;
		yield* cancelRecovery(notification);

		const newScheduledFnId = yield* scheduleSend(delayMs, args.notificationId);

		yield* withMutation((ctx) =>
			ctx.db.patch('pendingAdminNotifications', args.notificationId, {
				scheduledFor: Date.now() + delayMs,
				scheduledFnId: newScheduledFnId,
				claimToken: undefined,
				claimLeaseExpiresAt: undefined,
				recoveryFnId: undefined,
				retryCount: nextRetryCount
			})
		);

		yield* Effect.sync(() =>
			console.log(
				`[reschedulePendingNotification] Rescheduled notification for thread ${notification.threadId} with ${delayMs}ms delay (retry ${nextRetryCount}/${MAX_RETRY_COUNT})`
			)
		);

		return true;
	});

const recoverNotificationClaim = (
	args: typeof NotificationRecoveryArgsSchema.Type
): SchedulingEffect<boolean> =>
	Effect.gen(function* () {
		const notification = yield* withMutation((ctx) =>
			ctx.db.get('pendingAdminNotifications', args.notificationId)
		);
		if (
			!notification ||
			notification.generation !== args.generation ||
			!isOwnedByClaim(notification, args.claimToken) ||
			notification.claimLeaseExpiresAt !== args.deadline ||
			Date.now() < args.deadline
		)
			return false;
		if ((notification.retryCount ?? 0) >= MAX_RETRY_COUNT) {
			yield* Effect.sync(() =>
				console.error(
					'[recoverNotificationClaim] Retry limit reached; abandoned notification stopped'
				)
			);
			yield* finishNotification(notification);
			return true;
		}
		return yield* withMutation((ctx): Promise<boolean> =>
			ctx.runMutation(internal.admin.support.notifications.reschedulePendingNotification, {
				notificationId: args.notificationId,
				claimToken: args.claimToken,
				delayMs: 60_000
			})
		);
	});

/**
 * Cancels a thread's pending notification when the ticket is closed or assigned
 * before the email goes out.
 */
const cancelPendingNotification = ({ threadId }: { threadId: string }): SchedulingEffect<boolean> =>
	Effect.gen(function* () {
		const pending = yield* withMutation((ctx) =>
			ctx.db
				.query('pendingAdminNotifications')
				.withIndex('by_thread', (q) => q.eq('threadId', threadId))
				.first()
		);
		if (!pending) return false;
		if (pending.scheduledFnId && (yield* isPending(pending.scheduledFnId))) {
			yield* (yield* Scheduler).cancel(pending.scheduledFnId);
		}
		yield* finishNotification(pending);
		return true;
	});

const getSupportThread = ({ threadId }: { threadId: string }) =>
	withQuery((ctx) =>
		ctx.db
			.query('supportThreads')
			.withIndex('by_thread', (q) => q.eq('threadId', threadId))
			.first()
	);

const listLegacyNotificationClaims = ({ paginationOpts }: typeof LegacyClaimsArgsSchema.Type) =>
	withQuery(async (ctx) => {
		const result = await ctx.db.query('pendingAdminNotifications').paginate({
			...paginationOpts,
			numItems: Math.min(100, paginationOpts.numItems),
			maximumBytesRead: 512 * 1024
		});
		// Missing receipts cannot establish whether an older sender already delivered.
		return {
			page: result.page
				.filter((row) => row.scheduledFnId === undefined && row.generation === undefined)
				.map((row) => row._id),
			continueCursor: result.continueCursor,
			isDone: result.isDone
		};
	});

/**
 * Returns the recipients of a notification type from adminNotificationPreferences.
 *
 * An assigned admin with the type enabled is the only recipient. Otherwise every
 * recipient with the type enabled, admin or custom email, receives it.
 */
const getNotificationTargetEmails = (args: typeof TargetEmailsArgsSchema.Type) =>
	withQuery(async (ctx) => {
		// eslint-disable-next-line @convex-dev/no-collect-in-query -- Bounded: rows exist only through admin actions (promotions, custom recipients), one per email
		const allPrefs = await ctx.db.query('adminNotificationPreferences').collect();
		const activePrefs = allPrefs.filter((p) => receivesNotification(p, args.notificationType));
		if (args.assignedTo) {
			const assignedPref = activePrefs.find((p) => p.userId === args.assignedTo);
			if (assignedPref) return [assignedPref.email];
		}
		return activePrefs.map((p) => p.email);
	});

/**
 * Formats messages from the agent component for the email.
 *
 * Each message is cut to 500 characters to keep the email small.
 */
const getMessageContents = (args: typeof MessageContentsArgsSchema.Type) =>
	withQuery(async (ctx) => {
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
				messages.push({ text: message.text.slice(0, 500), timestamp });
			}
		}

		return messages;
	});

/**
 * Returns the IDs of a thread's recent user messages in chronological order.
 *
 * The first notification of a thread that reaches the team includes them.
 * Assistant messages and the "Talk to support" message are left out.
 */
const getRecentUserMessages = (args: typeof RecentUserMessagesArgsSchema.Type) =>
	withQuery(async (ctx) => {
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

			return text.toLowerCase().trim() !== 'talk to support';
		});

		return userMessages
			.slice(0, maxMessages)
			.reverse()
			.map((msg) => msg._id);
	});

export default GroupImpl.make(databaseSchema, notifications).pipe(
	Layer.provide([
		FunctionImpl.make(databaseSchema, notifications, 'cancelPendingNotification', (args) =>
			Effect.gen(function* () {
				return yield* cancelPendingNotification(args);
			})
		),
		FunctionImpl.make(databaseSchema, notifications, 'claimNotificationForSending', (args) =>
			Effect.gen(function* () {
				return yield* claimNotificationForSending(args);
			})
		),
		FunctionImpl.make(databaseSchema, notifications, 'deletePendingNotification', (args) =>
			Effect.gen(function* () {
				return yield* deletePendingNotification(args);
			})
		),
		FunctionImpl.make(databaseSchema, notifications, 'getMessageContents', (args) =>
			Effect.gen(function* () {
				return yield* getMessageContents(args);
			})
		),
		FunctionImpl.make(databaseSchema, notifications, 'getNotificationTargetEmails', (args) =>
			Effect.gen(function* () {
				return yield* getNotificationTargetEmails(args);
			})
		),
		FunctionImpl.make(databaseSchema, notifications, 'getRecentUserMessages', (args) =>
			Effect.gen(function* () {
				return yield* getRecentUserMessages(args);
			})
		),
		FunctionImpl.make(databaseSchema, notifications, 'getSupportThread', (args) =>
			Effect.gen(function* () {
				return yield* getSupportThread(args);
			})
		),
		FunctionImpl.make(databaseSchema, notifications, 'listLegacyNotificationClaims', (args) =>
			Effect.gen(function* () {
				return yield* listLegacyNotificationClaims(args);
			})
		),
		FunctionImpl.make(databaseSchema, notifications, 'recoverNotificationClaim', (args) =>
			Effect.gen(function* () {
				return yield* recoverNotificationClaim(args);
			})
		),
		FunctionImpl.make(databaseSchema, notifications, 'reschedulePendingNotification', (args) =>
			Effect.gen(function* () {
				return yield* reschedulePendingNotification(args);
			})
		),
		FunctionImpl.make(databaseSchema, notifications, 'scheduleAdminNotification', (args) =>
			Effect.gen(function* () {
				return yield* scheduleAdminNotification(args);
			})
		),
		FunctionImpl.make(databaseSchema, notifications, 'sendPendingAdminNotification', (args) =>
			Effect.gen(function* () {
				return yield* sendPendingAdminNotification(args);
			})
		)
	]),
	GroupImpl.finalize
);
