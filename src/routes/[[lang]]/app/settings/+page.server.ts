import type { PageServerLoad } from './$types';
import { env } from '$env/dynamic/private';
import { api } from '$lib/convex/_generated/api.js';
import { createConvexHttpClient } from '@mmailaender/convex-better-auth-svelte/sveltekit';

export const load = (async (event) => {
	// Use internal URL if available (same Docker network = skip public internet hop)
	const client = createConvexHttpClient({
		token: event.locals.token,
		convexUrl: env.CONVEX_INTERNAL_URL || undefined
	});

	const user = await client.query(api.users.viewer, {});
	return {
		user
	};
}) satisfies PageServerLoad;
