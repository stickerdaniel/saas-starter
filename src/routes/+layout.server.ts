import { createConvexAuthHandlers } from '@mmailaender/convex-auth-svelte/sveltekit/server';
import { createAutumnHandlers } from '@stickerdaniel/convex-autumn-svelte/sveltekit/server';
import type { LayoutServerLoad } from './$types';
import { PUBLIC_CONVEX_URL } from '$env/static/public';
import { api } from '$lib/convex/_generated/api';

// Create auth handlers - explicitly pass the convexUrl from environment variables
const { getAuthState, createConvexHttpClient } = createConvexAuthHandlers({
	convexUrl: PUBLIC_CONVEX_URL
});

// Create Autumn handlers, delegating auth to Convex Auth
const { getCustomer } = createAutumnHandlers({
	convexApi: (api as any).autumn,
	createClient: createConvexHttpClient
});

// Export load function to provide auth state and billing data to layout
export const load: LayoutServerLoad = async (event) => {
	// Enables targeted invalidation via invalidate('autumn:customer') to refetch only customer data
	event.depends('autumn:customer');

	const authState = await getAuthState(event);
	const isAuthenticated = authState._state.token !== null;

	const customer = await getCustomer(event);

	// Only fetch viewer if authenticated (optimization for anonymous traffic)
	const client = await createConvexHttpClient(event);
	const viewer = isAuthenticated ? await client.query(api.users.viewer, {}) : null;

	return {
		authState,
		autumnState: {
			customer,
			_timeFetched: Date.now()
		},
		viewer
	};
};
