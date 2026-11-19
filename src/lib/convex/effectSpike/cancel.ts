/** T0 spike: `admin/customerNotifications/cancel.cancelUnsentEmails` on the Effect adapter. */
import * as Effect from 'effect/Effect';
import type { EmailId } from '@convex-dev/resend';
import { v } from 'convex/values';
import { effectInternalMutation, MutationRunner, QueryRunner } from '../effect';
import { resend } from '../emails/resend';

/** Port of `admin/customerNotifications/cancel.cancelUnsentEmails`. */
export const cancelUnsentEmails = effectInternalMutation({
	args: { emailIds: v.array(v.string()) },
	returns: v.null(),
	handler: ({ emailIds }) =>
		Effect.gen(function* () {
			const runQuery = yield* QueryRunner;
			const runMutation = yield* MutationRunner;
			for (const emailId of emailIds) {
				const status = yield* Effect.promise(() => resend.status({ runQuery }, emailId as EmailId));
				if (status?.status === 'waiting' || status?.status === 'queued') {
					yield* Effect.promise(() =>
						resend.cancelEmail({ runQuery, runMutation }, emailId as EmailId)
					);
				}
			}
			return null;
		})
});
