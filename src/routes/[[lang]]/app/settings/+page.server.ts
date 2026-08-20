import type { PageServerLoad } from './$types';
import { api } from '$lib/convex/_generated/api.js';
import { createServerConvexHttpClient } from '$lib/server/convex-http';

export const load = (async (event) => {
	// Primes the password card so it renders the right form on first paint. The
	// card still subscribes to the same query, so this is initial data rather
	// than the source of truth, and a null from a failed lookup self-corrects
	// after hydration. Started before awaiting parent() so it does not add a
	// second round trip to every settings visit.
	const hasPasswordPromise = (async () => {
		try {
			const client = createServerConvexHttpClient({ token: event.locals.token });
			return await client.query(api.users.hasPassword, {});
		} catch (e) {
			console.error('[settings/+page.server.ts] hasPassword lookup failed:', e);
			return null;
		}
	})();

	const [{ viewer }, hasPassword] = await Promise.all([event.parent(), hasPasswordPromise]);

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
