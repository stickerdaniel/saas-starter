import * as Effect from 'effect/Effect';
import type { PageServerLoad } from './$types';
import { api } from '#lib/convex/_generated/api.js';
import { createServerConvexHttpClient } from '#lib/server/convex-http.js';
import { fromPromise, runRequestEffect, ServerRequest } from '#lib/server/effect-runtime.js';
import { recoverWith, reportRecoveredFailure } from '#lib/server/recovered-failure.js';

export const load = ((event) => {
	// Primes the password card so it renders the right form on first paint. The
	// card still subscribes to the same query, so this is initial data rather
	// than the source of truth, and a null from a failed lookup self-corrects
	// after hydration. Started before awaiting parent() so it does not add a
	// second round trip to every settings visit.
	const hasPasswordLookup = Effect.gen(function* () {
		const { locals } = yield* ServerRequest;
		const client = createServerConvexHttpClient({ token: locals.token });
		return yield* fromPromise(() =>
			client.query(api.users.hasPassword, {}).catch((error: unknown) => {
				reportRecoveredFailure('[settings] hasPassword lookup failed', error);
				return null;
			})
		);
	}).pipe(recoverWith('[settings] hasPassword lookup failed', null));

	return runRequestEffect(
		event,
		Effect.gen(function* () {
			const [hasPassword, { viewer }] = yield* Effect.all(
				[hasPasswordLookup, Effect.promise(() => event.parent())],
				{ concurrency: 'unbounded' }
			);

			return {
				hasPassword,
				user: viewer
					? {
							name: viewer.name ?? undefined,
							email: viewer.email ?? undefined,
							image: viewer.image ?? null,
							emailVerified: 'emailVerified' in viewer ? viewer.emailVerified : false
						}
					: null
			};
		})
	);
}) satisfies PageServerLoad;
