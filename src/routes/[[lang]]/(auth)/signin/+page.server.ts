import type { PageServerLoad } from './$types';
import { api } from '$lib/convex/_generated/api.js';
import { createServerConvexHttpClient } from '$lib/server/convex-http';

export const load = (async () => {
	const client = createServerConvexHttpClient({});
	// Degrade gracefully on transient backend failure; the client useQuery
	// subscription recovers the real provider availability after hydration.
	const oauthProviders = await client.query(api.auth.getAvailableOAuthProviders, {}).catch((e) => {
		console.error('[signin/+page.server.ts] OAuth provider lookup failed:', e);
		return { google: false, github: false };
	});
	return { oauthProviders };
}) satisfies PageServerLoad;
