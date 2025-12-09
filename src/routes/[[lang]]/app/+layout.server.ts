import type { LayoutServerLoad } from './$types';
import { api } from '$lib/convex/_generated/api.js';
import { createConvexHttpClient } from '@mmailaender/convex-better-auth-svelte/sveltekit';

export const load = (async (event) => {
	const client = createConvexHttpClient({ token: event.locals.token });

	const viewer = await client.query(api.users.viewer, {});
	return {
		viewer
	};
}) satisfies LayoutServerLoad;
