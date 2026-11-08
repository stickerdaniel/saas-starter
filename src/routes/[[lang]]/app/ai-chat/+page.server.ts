import type { PageServerLoad } from './$types';
import { api } from '#lib/convex/_generated/api.js';
import { createServerConvexHttpClient } from '#lib/server/convex-http.js';
import { reportRecoveredFailure } from '#lib/server/recovered-failure.js';

export const load = (async (event) => {
	// Degrade gracefully on any backend failure, including client construction
	// (a missing CONVEX_INTERNAL_URL/PUBLIC_CONVEX_URL throws before the query):
	// the client useQuery subscription recovers the viewer after hydration, so
	// this SSR load must never 500 the page.
	try {
		const client = createServerConvexHttpClient({ token: event.locals.token });
		const viewer = await client.query(api.users.viewer, {});
		return { viewer };
	} catch (e) {
		reportRecoveredFailure('[ai-chat] Viewer lookup failed', e);
		return { viewer: null };
	}
}) satisfies PageServerLoad;
