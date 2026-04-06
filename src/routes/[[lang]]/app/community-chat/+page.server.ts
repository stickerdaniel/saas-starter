import type { PageServerLoad } from './$types';
import { api } from '$lib/convex/_generated/api.js';
import { createServerConvexHttpClient } from '$lib/server/convex-http';

export const load = (async (event) => {
	const client = createServerConvexHttpClient({ token: event.locals.token });

	const [viewer, messages] = await Promise.all([
		client.query(api.users.viewer, {}),
		client.query(api.messages.list, {})
	]);
	return {
		viewer,
		messages
	};
}) satisfies PageServerLoad;
