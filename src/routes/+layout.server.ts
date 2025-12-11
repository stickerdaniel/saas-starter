import type { LayoutServerLoad } from './$types';
import { api } from '$lib/convex/_generated/api';
import { createConvexHttpClient } from '@mmailaender/convex-better-auth-svelte/sveltekit';
import { createAutumnHandlers } from '@stickerdaniel/convex-autumn-svelte/sveltekit/server';

export const load: LayoutServerLoad = async (event) => {
	// Enables targeted invalidation via invalidate('autumn:customer') to refetch only customer data
	event.depends('autumn:customer');

	// Check if JWT token exists (set by handleAuth in hooks.server.ts)
	const isAuthenticated = !!event.locals.token;
	const authState = { isAuthenticated };

	const client = createConvexHttpClient({ token: event.locals.token });

	// Autumn handlers - update to use new client factory
	const { getCustomer } = createAutumnHandlers({
		convexApi: (api as any).autumn,
		createClient: () => client
	});

	// Only fetch customer and viewer data if authenticated (optimization for anonymous traffic)
	const customer = isAuthenticated ? await getCustomer(event) : null;
	const viewer = isAuthenticated ? await client.query(api.auth.getCurrentUser, {}) : null;

	return {
		authState,
		autumnState: {
			customer,
			_timeFetched: Date.now()
		},
		viewer
	};
};
