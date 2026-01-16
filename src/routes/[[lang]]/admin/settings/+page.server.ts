import type { PageServerLoad } from './$types';
import { api } from '$lib/convex/_generated/api.js';
import { createConvexHttpClient } from '@mmailaender/convex-better-auth-svelte/sveltekit';

export const load = (async (event) => {
	const client = createConvexHttpClient({ token: event.locals.token });
	const defaultSupportEmail = await client.query(
		api.admin.settings.queries.getDefaultSupportEmail,
		{}
	);
	return { defaultSupportEmail };
}) satisfies PageServerLoad;
