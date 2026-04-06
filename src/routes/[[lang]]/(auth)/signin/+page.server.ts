import type { PageServerLoad } from './$types';
import { api } from '$lib/convex/_generated/api.js';
import { createServerConvexHttpClient } from '$lib/server/convex-http';

export const load = (async () => {
	const client = createServerConvexHttpClient({});
	const oauthProviders = await client.query(api.auth.getAvailableOAuthProviders, {});
	return { oauthProviders };
}) satisfies PageServerLoad;
