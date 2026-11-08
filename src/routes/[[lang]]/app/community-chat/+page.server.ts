import type { PageServerLoad } from './$types';
import { api } from '#lib/convex/_generated/api.js';
import { createServerConvexHttpClient } from '#lib/server/convex-http.js';
import { reportRecoveredFailure } from '#lib/server/recovered-failure.js';

export const load = (async (event) => {
	// Degrade gracefully on any backend failure, including client construction
	// (a missing CONVEX_INTERNAL_URL/PUBLIC_CONVEX_URL throws before the query):
	// the client useQuery subscriptions recover viewer and messages after
	// hydration, so this SSR load must never 500 the page.
	try {
		const client = createServerConvexHttpClient({ token: event.locals.token });
		const [viewer, messages] = await Promise.all([
			client.query(api.users.viewer, {}).catch((e) => {
				reportRecoveredFailure('[community-chat] Viewer lookup failed', e);
				return null;
			}),
			client.query(api.messages.list, {}).catch((e) => {
				reportRecoveredFailure('[community-chat] Messages lookup failed', e);
				return [];
			})
		]);
		return { viewer, messages };
	} catch (e) {
		reportRecoveredFailure('[community-chat] Convex client unavailable', e);
		return { viewer: null, messages: [] };
	}
}) satisfies PageServerLoad;
