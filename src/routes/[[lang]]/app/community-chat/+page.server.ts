import type { PageServerLoad } from './$types';
import { api } from '$lib/convex/_generated/api.js';
import { createServerConvexHttpClient } from '$lib/server/convex-http';

export const load = (async (event) => {
	const client = createServerConvexHttpClient({ token: event.locals.token });

	// Degrade gracefully on transient backend failure; the client useQuery
	// subscriptions recover viewer and messages after hydration.
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
	return {
		viewer,
		messages
	};
}) satisfies PageServerLoad;
