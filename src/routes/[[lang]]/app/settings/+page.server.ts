import type { PageServerLoad } from './$types';
import { api } from '$lib/convex/_generated/api.js';
import { createConvexHttpClient } from '@mmailaender/convex-better-auth-svelte/sveltekit';

export const load = (async (event) => {
	const client = createConvexHttpClient({ token: event.locals.token });

	const user = await client.query(api.users.viewer, {});
	return {
		user
	};
}) satisfies PageServerLoad;
