import * as Effect from 'effect/Effect';
import type { PageServerLoad } from './$types';
import { api } from '#lib/convex/_generated/api.js';
import { createServerConvexHttpClient } from '#lib/server/convex-http.js';
import { fromPromise, runServerEffect } from '#lib/server/effect-runtime.js';
import { recoverWith } from '#lib/server/recovered-failure.js';

export const load = (() => {
	// Degrade gracefully on any backend failure, including client construction
	// (a missing CONVEX_INTERNAL_URL/PUBLIC_CONVEX_URL throws before the query):
	// the client useQuery subscription recovers the real provider availability
	// after hydration, so this SSR step must never 500 the admin users page.
	return runServerEffect(
		Effect.gen(function* () {
			const client = createServerConvexHttpClient({});
			const oauthProviders = yield* fromPromise(() =>
				client.query(api.auth.getAvailableOAuthProviders, {})
			);
			return { oauthProviders };
		}).pipe(
			recoverWith('[admin/users] OAuth provider lookup failed', {
				oauthProviders: { google: false, github: false }
			})
		)
	);
}) satisfies PageServerLoad;
