import type { LayoutServerLoad } from './$types';
import { api } from '$lib/convex/_generated/api.js';
import { createConvexAuthHandlers } from '$lib/sveltekit/server';

export const load = (async (event) => {
	const { createConvexHttpClient } = await createConvexAuthHandlers();
	const client = await createConvexHttpClient(event);

	const viewer = await client.query(api.users.viewer, {});
	return {
		viewer
	};
}) satisfies LayoutServerLoad;
