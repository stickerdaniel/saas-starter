import type { PageServerLoad } from './$types';
import { api } from '$lib/convex/_generated/api.js';
import { createServerConvexHttpClient } from '$lib/server/convex-http';

export const load = (async () => {
	// Degrade gracefully on any backend failure, including client construction
	// (a missing CONVEX_INTERNAL_URL/PUBLIC_CONVEX_URL throws before the query):
	// the client useQuery subscription recovers the real provider availability
	// after hydration, so this SSR step must never 500 the admin users page.
	try {
		const client = createServerConvexHttpClient({});
		const oauthProviders = await client.query(api.auth.getAvailableOAuthProviders, {});
		return { oauthProviders };
	} catch (e) {
		console.error('[admin/users/+page.server.ts] OAuth provider lookup failed:', e);
		return { oauthProviders: { google: false, github: false } };
	}
}) satisfies PageServerLoad;
