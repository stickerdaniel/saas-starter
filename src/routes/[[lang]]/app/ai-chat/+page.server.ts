import type { PageServerLoad } from './$types';
import { api } from '$lib/convex/_generated/api.js';
import { createServerConvexHttpClient } from '$lib/server/convex-http';

export const load = (async (event) => {
	const client = createServerConvexHttpClient({ token: event.locals.token });

	// Degrade gracefully on transient backend failure; the client useQuery
	// subscription recovers the viewer after hydration.
	const viewer = await client.query(api.users.viewer, {}).catch((e) => {
		console.error('[ai-chat/+page.server.ts] Viewer lookup failed:', e);
		return null;
	});
	return { viewer };
}) satisfies PageServerLoad;
