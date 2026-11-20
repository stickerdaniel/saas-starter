/** T0 spike: `users.getPasskeyNudgeDismissal` on the Effect adapter. */
import * as Effect from 'effect/Effect';
import { v } from 'convex/values';
import { call, DatabaseReader } from '../effect';
import { CurrentUser, effectAuthedQuery } from '../effectAuth';

/** Port of `users.getPasskeyNudgeDismissal`. */
export const passkeyNudgeDismissal = effectAuthedQuery({
	args: {},
	returns: v.number(),
	handler: () =>
		Effect.gen(function* () {
			const user = yield* CurrentUser;
			const dismissal = yield* call(DatabaseReader, (db) =>
				db
					.query('passkeyNudgeDismissals')
					.withIndex('by_userId', (q) => q.eq('userId', user._id))
					.unique()
			);
			return dismissal?.deferredUntil ?? 0;
		})
});
