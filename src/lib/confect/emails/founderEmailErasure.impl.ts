import { FunctionImpl, GroupImpl } from '@confect/server';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import refs from '../_generated/refs';
import databaseSchema from '../_generated/schema';
import { MutationCtx, MutationRunner } from '../_generated/services';
import {
	cancelPendingSend,
	ROWS_PER_PAGE,
	runErasurePage,
	sendRows,
	suppressionRows,
	welcomeRows
} from './founderEmailErasure';
import founderEmailErasure from './founderEmailErasure.spec';

export default GroupImpl.make(databaseSchema, founderEmailErasure).pipe(
	Layer.provide([
		FunctionImpl.make(
			databaseSchema,
			founderEmailErasure,
			'continueFounderEmailErasure',
			({ userId, attempt }) =>
				Effect.gen(function* () {
					const ctx = yield* MutationCtx;
					yield* Effect.promise(() => runErasurePage(ctx, userId, attempt));
					return null;
				})
		),
		FunctionImpl.make(databaseSchema, founderEmailErasure, 'eraseFounderEmailPage', ({ userId }) =>
			Effect.gen(function* () {
				const ctx = yield* MutationCtx;
				const welcomes = yield* Effect.promise(() => welcomeRows(ctx, userId).take(ROWS_PER_PAGE));
				const sends = yield* Effect.promise(() =>
					sendRows(ctx, userId).take(ROWS_PER_PAGE - welcomes.length)
				);
				const suppressions = yield* Effect.promise(() =>
					suppressionRows(ctx, userId).take(ROWS_PER_PAGE - welcomes.length - sends.length)
				);

				const emailIds = [...welcomes, ...sends].flatMap((row) =>
					row.emailId ? [row.emailId] : []
				);
				if (emailIds.length > 0) {
					yield* (yield* MutationRunner)
						.runMutation(refs.internal.admin.customerNotifications.cancel.cancelUnsentEmails, {
							emailIds
						})
						.pipe(Effect.orDie);
				}
				for (const row of welcomes) {
					yield* Effect.promise(() => cancelPendingSend(ctx, row.scheduledFnId));
					yield* Effect.promise(() => ctx.db.delete('founderWelcomeEmails', row._id));
				}
				for (const row of sends) {
					yield* Effect.promise(() => cancelPendingSend(ctx, row.scheduledFnId));
					yield* Effect.promise(() => ctx.db.delete('founderEmailSends', row._id));
				}
				for (const row of suppressions) {
					yield* Effect.promise(() => ctx.db.delete('personalEmailSuppressions', row._id));
				}

				return yield* Effect.promise(
					async () =>
						(await welcomeRows(ctx, userId).first()) !== null ||
						(await sendRows(ctx, userId).first()) !== null ||
						(await suppressionRows(ctx, userId).first()) !== null
				);
			})
		)
	]),
	GroupImpl.finalize
);
