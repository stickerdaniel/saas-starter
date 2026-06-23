import type { PageServerLoad } from './$types';
import { api } from '$lib/convex/_generated/api.js';
import { createServerConvexHttpClient } from '$lib/server/convex-http';

export const load = (async (event) => {
	// Degrade gracefully on any backend failure, including client construction
	// (a missing CONVEX_INTERNAL_URL/PUBLIC_CONVEX_URL throws before the query):
	// the client useQuery subscriptions recover viewer and messages after
	// hydration, so this SSR load must never 500 the page.
	try {
		const client = createServerConvexHttpClient({ token: event.locals.token });
		const [viewer, messages] = await Promise.all([
			client.query(api.users.viewer, {}).catch((e) => {
				console.error('[community-chat/+page.server.ts] Viewer lookup failed:', e);
				return null;
			}),
			client.query(api.messages.list, {}).catch((e) => {
				console.error('[community-chat/+page.server.ts] Messages lookup failed:', e);
				return [];
			})
		]);
		return { viewer, messages };
	} catch (e) {
		console.error('[community-chat/+page.server.ts] Convex client unavailable:', e);
		return { viewer: null, messages: [] };
	}
}) satisfies PageServerLoad;
