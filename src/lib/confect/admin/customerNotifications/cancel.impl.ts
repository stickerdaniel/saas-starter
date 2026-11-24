import type { EmailId } from '@convex-dev/resend';
import { FunctionImpl, GroupImpl } from '@confect/server';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import databaseSchema from '../../_generated/schema';
import { MutationCtx } from '../../_generated/services';
import { resend } from '../../emails/resend';
import cancel from './cancel.spec';

export default GroupImpl.make(databaseSchema, cancel).pipe(
	Layer.provide([
		FunctionImpl.make(databaseSchema, cancel, 'cancelUnsentEmails', ({ emailIds }) =>
			Effect.gen(function* () {
				const ctx = yield* MutationCtx;
				for (const emailId of emailIds) {
					const status = yield* Effect.promise(() => resend.status(ctx, emailId as EmailId));
					if (status?.status === 'waiting' || status?.status === 'queued') {
						yield* Effect.promise(() => resend.cancelEmail(ctx, emailId as EmailId));
					}
				}
				return null;
			})
		)
	]),
	GroupImpl.finalize
);
