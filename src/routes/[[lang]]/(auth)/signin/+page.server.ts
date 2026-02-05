import type { PageServerLoad } from './$types';
import { env } from '$env/dynamic/private';
import { api } from '$lib/convex/_generated/api.js';
import { createConvexHttpClient } from '@mmailaender/convex-better-auth-svelte/sveltekit';

export const load = (async () => {
	// Use internal URL if available (same Docker network = skip public internet hop)
	const client = createConvexHttpClient({ convexUrl: env.CONVEX_INTERNAL_URL || undefined });
	const oauthProviders = await client.query(api.auth.getAvailableOAuthProviders, {});
	return { oauthProviders };
}) satisfies PageServerLoad;
