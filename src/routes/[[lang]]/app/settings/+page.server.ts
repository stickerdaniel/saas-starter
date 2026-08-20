import type { PageServerLoad } from './$types';
import { api } from '$lib/convex/_generated/api.js';
import { createServerConvexHttpClient } from '$lib/server/convex-http';

export const load = (async (event) => {
	const { viewer } = await event.parent();

	// Resolved here rather than in the component so the password card renders
	// the right form on first paint. null means the lookup did not answer; the
	// card then falls back to the change form, which is the stricter of the two.
	let hasPassword: boolean | null = null;
	try {
		const client = createServerConvexHttpClient({ token: event.locals.token });
		hasPassword = await client.query(api.users.hasPassword, {});
	} catch (e) {
		console.error('[settings/+page.server.ts] hasPassword lookup failed:', e);
	}

	return {
		hasPassword,
		user: viewer
			? {
					name: viewer.name ?? undefined,
					email: viewer.email ?? undefined,
					image: viewer.image ?? null,
					emailVerified: 'emailVerified' in viewer ? viewer.emailVerified : false
				}
			: null
	};
}) satisfies PageServerLoad;
