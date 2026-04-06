import type { PageServerLoad } from './$types';
import { api } from '$lib/convex/_generated/api.js';
import { createServerConvexHttpClient } from '$lib/server/convex-http';

export const load = (async (event) => {
	const client = createServerConvexHttpClient({ token: event.locals.token });

	const viewer = await client.query(api.users.viewer, {});
	return { viewer };
}) satisfies PageServerLoad;
