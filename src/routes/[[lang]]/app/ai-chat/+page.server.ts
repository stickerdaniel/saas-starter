import * as Effect from 'effect/Effect';
import type { PageServerLoad } from './$types';
import { api } from '#lib/convex/_generated/api.js';
import { createServerConvexHttpClient } from '#lib/server/convex-http.js';
import { fromPromise, runRequestEffect, ServerRequest } from '#lib/server/effect-runtime.js';
import { recoverWith } from '#lib/server/recovered-failure.js';

export const load = ((event) => {
	// Degrade gracefully on any backend failure, including client construction
	// (a missing CONVEX_INTERNAL_URL/PUBLIC_CONVEX_URL throws before the query):
	// the client useQuery subscription recovers the viewer after hydration, so
	// this SSR load must never 500 the page.
	return runRequestEffect(
		event,
		Effect.gen(function* () {
			const { locals } = yield* ServerRequest;
			const client = createServerConvexHttpClient({ token: locals.token });
			const viewer = yield* fromPromise(() => client.query(api.users.viewer, {}));
			return { viewer };
		}).pipe(recoverWith('[ai-chat] Viewer lookup failed', { viewer: null }))
	);
}) satisfies PageServerLoad;
