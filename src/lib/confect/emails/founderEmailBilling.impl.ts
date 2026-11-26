import { FunctionImpl, GroupImpl } from '@confect/server';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import type { Id } from '../../convex/_generated/dataModel';
import refs from '../_generated/refs';
import databaseSchema from '../_generated/schema';
import { ActionCtx, MutationRunner, QueryRunner } from '../_generated/services';
import { readCustomerBilling } from '../admin/customerNotifications/autumnRead';
import {
	classifyFeedbackBilling,
	findWelcomeThread,
	readScheduledCancellation
} from './founderEmailBilling';
import founderEmailBilling from './founderEmailBilling.spec';

const recordSendFailure = (sendId: Id<'founderEmailSends'>) =>
	Effect.gen(function* () {
		yield* (yield* MutationRunner)
			.runMutation(refs.internal.emails.founderEmails.recordFounderEmailSendFailure, { sendId })
			.pipe(Effect.orDie);
	});

const deliverVerdict = <E, R>(
	sendId: Id<'founderEmailSends'>,
	send: Effect.Effect<unknown, E, R>
): Effect.Effect<void, never, R | MutationRunner> =>
	send.pipe(
		Effect.asVoid,
		Effect.catchCause(() =>
			Effect.gen(function* () {
				console.warn({ code: 'founder_email_send_failed' });
				yield* recordSendFailure(sendId);
			})
		)
	);

const isPending = (sendId: Id<'founderEmailSends'>) =>
	Effect.gen(function* () {
		return yield* (yield* QueryRunner).runQuery(
			refs.internal.emails.founderEmailLedger.isFounderEmailSendPending,
			{ sendId }
		);
	}).pipe(
		Effect.catchCause(() =>
			Effect.gen(function* () {
				console.warn({ code: 'founder_email_preflight_failed' });
				yield* recordSendFailure(sendId);
				return false;
			})
		)
	);

export default GroupImpl.make(databaseSchema, founderEmailBilling).pipe(
	Layer.provide([
		FunctionImpl.make(
			databaseSchema,
			founderEmailBilling,
			'resolveFounderCancellationBilling',
			({ sendId, userId, attempt }) =>
				Effect.gen(function* () {
					if (!(yield* isPending(sendId))) return null;
					const billing = yield* readScheduledCancellation(userId);
					const mutations = yield* MutationRunner;
					yield* deliverVerdict(
						sendId,
						mutations.runMutation(refs.internal.emails.founderEmails.sendFounderCancellationEmail, {
							sendId,
							attempt,
							billing
						})
					);
					return null;
				})
		),
		FunctionImpl.make(
			databaseSchema,
			founderEmailBilling,
			'resolveFounderFeedbackBilling',
			({ sendId, userId }) =>
				Effect.gen(function* () {
					if (!(yield* isPending(sendId))) return null;
					const read = yield* readCustomerBilling(userId);
					const billing = classifyFeedbackBilling(read, Date.now());
					if (billing === 'billing_unknown')
						console.warn({ code: 'founder_feedback_billing_unknown' });
					const ctx = yield* ActionCtx;
					const thread =
						billing === 'not_subscribed' ? yield* findWelcomeThread(ctx, userId) : undefined;
					const mutations = yield* MutationRunner;
					yield* deliverVerdict(
						sendId,
						mutations.runMutation(refs.internal.emails.founderEmails.sendFounderFeedbackEmail, {
							sendId,
							billing,
							...(thread && { thread })
						})
					);
					return null;
				})
		)
	]),
	GroupImpl.finalize
);
