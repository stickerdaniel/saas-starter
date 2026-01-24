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

	// Autumn handlers for billing/subscription data
	const { getCustomer } = createAutumnHandlers({
		convexApi: (api as any).autumn,
		createClient: () => client
	});

	// Fetch customer and viewer in PARALLEL for faster initial load
	// Wrap getCustomer in try-catch to handle Autumn failures gracefully (e.g., in CI)
	const [customer, viewer] = isAuthenticated
		? await Promise.all([
				getCustomer(event).catch((e) => {
					console.error('[+layout.server.ts] Autumn getCustomer failed:', e);
					return null;
				}),
				client.query(api.auth.getCurrentUser, {})
			])
		: [null, null];

	return {
		authState,
		autumnState: {
			customer,
			_timeFetched: Date.now()
		},
		viewer
	};
};
