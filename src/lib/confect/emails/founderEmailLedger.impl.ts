import { FunctionImpl, GroupImpl } from '@confect/server';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import databaseSchema from '../_generated/schema';
import { QueryCtx } from '../_generated/services';
import founderEmailLedger from './founderEmailLedger.spec';

export default GroupImpl.make(databaseSchema, founderEmailLedger).pipe(
	Layer.provide([
		FunctionImpl.make(databaseSchema, founderEmailLedger, 'getSentFounderWelcome', ({ userId }) =>
			Effect.gen(function* () {
				const ctx = yield* QueryCtx;
				const row = yield* Effect.promise(() =>
					ctx.db
						.query('founderWelcomeEmails')
						.withIndex('by_user', (q) => q.eq('userId', userId))
						.unique()
				);
				if (row?.status !== 'sent' || !row.emailId || !row.subject) return null;
				return { emailId: row.emailId, subject: row.subject };
			})
		),
		FunctionImpl.make(
			databaseSchema,
			founderEmailLedger,
			'isFounderEmailSendPending',
			({ sendId }) =>
				Effect.gen(function* () {
					const ctx = yield* QueryCtx;
					const row = yield* Effect.promise(() => ctx.db.get('founderEmailSends', sendId));
					return row?.status === 'scheduled';
				})
		)
	]),
	GroupImpl.finalize
);
