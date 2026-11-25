import { FunctionImpl, GroupImpl } from '@confect/server';
import * as DateTime from 'effect/DateTime';
import * as Duration from 'effect/Duration';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import type { Id } from '../../convex/_generated/dataModel';
import type { MutationCtx as ConvexMutationCtx } from '../../convex/_generated/server';
import refs from '../_generated/refs';
import databaseSchema from '../_generated/schema';
import { MutationCtx, Scheduler } from '../_generated/services';
import { readAuthUser } from './founderEmailConfig';
import {
	checkFounderEmailGuards,
	FOUNDER_CANCELLATION_BILLING_ATTEMPTS,
	FOUNDER_CANCELLATION_BILLING_BACKOFF_MS,
	readSendRow,
	sendFounderEmail,
	skipRow
} from './founderEmails';
import founderEmails from './founderEmails.spec';

const markSent = (
	ctx: ConvexMutationCtx,
	sendId: Id<'founderEmailSends'>,
	{ emailId, subject }: { emailId: string; subject: string }
) =>
	Effect.promise(() =>
		ctx.db.patch('founderEmailSends', sendId, {
			status: 'sent',
			sentAt: Date.now(),
			emailId,
			subject
		})
	).pipe(Effect.as(null));

export default GroupImpl.make(databaseSchema, founderEmails).pipe(
	Layer.provide([
		FunctionImpl.make(
			databaseSchema,
			founderEmails,
			'recordFounderEmailSendFailure',
			({ sendId }) =>
				Effect.gen(function* () {
					const ctx = yield* MutationCtx;
					const row = yield* Effect.promise(() => ctx.db.get('founderEmailSends', sendId));
					if (row?.status !== 'scheduled') return null;
					return yield* Effect.promise(() => skipRow(ctx, sendId, 'send_failed'));
				})
		),
		FunctionImpl.make(
			databaseSchema,
			founderEmails,
			'sendFounderCancellationEmail',
			({ sendId, attempt, billing }) =>
				Effect.gen(function* () {
					const ctx = yield* MutationCtx;
					const row = yield* Effect.promise(() => readSendRow(ctx, sendId, 'cancellation'));
					if (!row) return null;

					const guards = yield* Effect.promise(() =>
						checkFounderEmailGuards(ctx, {
							userId: row.userId,
							email: 'cancellation',
							recipientEmail: row.recipientEmail
						})
					);
					if (!guards.ok) return yield* Effect.promise(() => skipRow(ctx, row._id, guards.reason));
					if (guards.enabledAt > Number(row.dedupeKey)) {
						return yield* Effect.promise(() =>
							skipRow(ctx, row._id, 'switched_on_after_cancellation')
						);
					}

					if (billing.cancellation === 'unknown') {
						if (attempt < FOUNDER_CANCELLATION_BILLING_ATTEMPTS) {
							const scheduledFnId = yield* (yield* Scheduler).runAt(
								DateTime.mapEpochMillis(
									DateTime.makeUnsafe(Date.now()),
									(now) => now + attempt * FOUNDER_CANCELLATION_BILLING_BACKOFF_MS
								),
								refs.internal.emails.founderEmailBilling.resolveFounderCancellationBilling,
								{ sendId: row._id, userId: row.userId, attempt: attempt + 1 }
							);
							yield* Effect.promise(() =>
								ctx.db.patch('founderEmailSends', row._id, { scheduledFnId })
							);
							return null;
						}
						console.warn({ code: 'founder_cancellation_billing_unknown' });
						return yield* Effect.promise(() => skipRow(ctx, row._id, 'billing_unknown'));
					}
					if (billing.cancellation === 'none' || String(billing.canceledAt) !== row.dedupeKey) {
						return yield* Effect.promise(() => skipRow(ctx, row._id, 'cancellation_reverted'));
					}

					const sent = yield* Effect.promise(() =>
						sendFounderEmail(ctx, {
							kind: 'founder-cancellation',
							sender: guards.sender,
							recipient: guards.recipient,
							template: guards.template
						})
					);
					return yield* markSent(ctx, row._id, sent);
				})
		),
		FunctionImpl.make(
			databaseSchema,
			founderEmails,
			'sendFounderFeedbackEmail',
			({ sendId, billing, thread }) =>
				Effect.gen(function* () {
					const ctx = yield* MutationCtx;
					const row = yield* Effect.promise(() => readSendRow(ctx, sendId, 'feedback'));
					if (!row) return null;

					const guards = yield* Effect.promise(() =>
						checkFounderEmailGuards(ctx, {
							userId: row.userId,
							email: 'feedback',
							recipientEmail: row.recipientEmail
						})
					);
					if (!guards.ok) return yield* Effect.promise(() => skipRow(ctx, row._id, guards.reason));

					if (billing === undefined) {
						const scheduledFnId = yield* (yield* Scheduler).runAfter(
							Duration.zero,
							refs.internal.emails.founderEmailBilling.resolveFounderFeedbackBilling,
							{ sendId: row._id, userId: row.userId }
						);
						yield* Effect.promise(() =>
							ctx.db.patch('founderEmailSends', row._id, { scheduledFnId })
						);
						return null;
					}
					if (billing !== 'not_subscribed') {
						return yield* Effect.promise(() => skipRow(ctx, row._id, billing));
					}

					const sent = yield* Effect.promise(() =>
						sendFounderEmail(ctx, {
							kind: 'founder-feedback',
							sender: guards.sender,
							recipient: guards.recipient,
							template: guards.template,
							thread
						})
					);
					return yield* markSent(ctx, row._id, sent);
				})
		),
		FunctionImpl.make(
			databaseSchema,
			founderEmails,
			'setPersonalEmailSuppression',
			({ userId, suppressed }) =>
				Effect.gen(function* () {
					const ctx = yield* MutationCtx;
					if (!(yield* Effect.promise(() => readAuthUser(ctx, userId)))) {
						return yield* Effect.die(new Error('User not found'));
					}
					const existing = yield* Effect.promise(() =>
						ctx.db
							.query('personalEmailSuppressions')
							.withIndex('by_user', (q) => q.eq('userId', userId))
							.unique()
					);
					if (suppressed && !existing) {
						yield* Effect.promise(() =>
							ctx.db.insert('personalEmailSuppressions', { userId, createdAt: Date.now() })
						);
					} else if (!suppressed && existing) {
						yield* Effect.promise(() => ctx.db.delete('personalEmailSuppressions', existing._id));
					}
					return null;
				})
		)
	]),
	GroupImpl.finalize
);
