import type { ServerLoadEvent } from '@sveltejs/kit';
import { api } from '$lib/convex/_generated/api';
import { createAutumnHandlers } from '@stickerdaniel/convex-autumn-svelte/sveltekit/server';
import { createServerConvexHttpClient } from '$lib/server/convex-http';
import { decodeJwtPayload } from '$lib/server/jwt';

type JwtViewer = {
	_id: string;
	name?: string | null;
	email?: string | null;
	image?: string | null;
	role?: string;
	emailVerified?: boolean;
	createdAt?: number;
	updatedAt?: number;
	banned?: boolean;
	locale?: string;
};

function getViewerFromJwt(token: string | undefined): JwtViewer | null {
	const decoded = decodeJwtPayload(token);
	if (!decoded) return null;

	return {
		_id: decoded.sub,
		name: decoded.name ?? null,
		email: decoded.email ?? null,
		image: decoded.image ?? null,
		role: decoded.role,
		emailVerified: decoded.emailVerified,
		createdAt: decoded.createdAt,
		updatedAt: decoded.updatedAt,
		banned: decoded.banned,
		locale: decoded.locale
	};
}

/**
 * Resolves the auth-coupled layout data (authState, viewer, autumnState) for a
 * server load. Shared by the root layout (marketing/auth SSR) and the /app and
 * /admin layouts.
 *
 * Why the /app and /admin layouts resolve this again instead of relying on the
 * root layout: marketing pages prerender, which freezes the root layout's data
 * at build time (unauthenticated: viewer null, isAuthenticated false).
 * SvelteKit never reruns a parent server load on client-side navigation
 * (sveltejs/kit#4426), and invalidate() against a prerendered route fetches the
 * static __data.json, so the frozen values survive into /app after a
 * client-side navigation from a marketing page. A layout server load inside the
 * authenticated group can never be prerendered, so on a client-side navigation
 * (isDataRequest) it resolves fresh against the live cookie and its returned
 * keys override the frozen root values in the merged page.data. On a full
 * document load the group layouts defer to the root, which already ran with the
 * cookie, so this is resolved once per request (see the isDataRequest guard in
 * the group layout loads).
 */
export async function resolveAuthLayoutData(event: ServerLoadEvent) {
	// Enables targeted invalidation via invalidate('autumn:customer') to refetch only customer data
	event.depends('autumn:customer');
	// Enables targeted invalidation when client-side auth state diverges from server state.
	// Prerendered pages bake authState.isAuthenticated: false at build time — when the client
	// recovers a session from cookies, AppAuthProvider detects the mismatch and calls
	// invalidate('app:auth') to re-run this load with fresh cookies.
	event.depends('app:auth');

	// Check if JWT token exists (set by handleAuth in hooks.server.ts)
	const isAuthenticated = !!event.locals.token;
	const authState = { isAuthenticated };
	const fallbackViewer = getViewerFromJwt(event.locals.token);

	// Only create Convex/Autumn clients when authenticated (avoids invalid URL during prerendering)
	let customer = null;
	let viewer = null;

	if (isAuthenticated) {
		// The whole block is guarded: client construction (a missing
		// CONVEX_INTERNAL_URL/PUBLIC_CONVEX_URL throws here) and the autumn
		// handler setup run before the per-query .catch, so an unguarded failure
		// here would 500 every authenticated SSR page. Fall back to the JWT
		// viewer + null customer; the client subscriptions recover after hydration.
		try {
			const client = createServerConvexHttpClient({ token: event.locals.token });

			const { getCustomer } = createAutumnHandlers({
				convexApi: (api as any).autumn,
				createClient: () => client
			});

			// Fetch customer and viewer in PARALLEL for faster initial load
			[customer, viewer] = await Promise.all([
				getCustomer(event).catch((e) => {
					console.error('[auth-layout-data] Autumn getCustomer failed:', e);
					return null;
				}),
				client.query(api.users.viewer, {}).catch((e) => {
					console.error('[auth-layout-data] Viewer lookup failed, falling back to JWT payload:', e);
					return fallbackViewer;
				})
			]);
		} catch (e) {
			console.error('[auth-layout-data] Convex client unavailable, using JWT fallback:', e);
			customer = null;
			viewer = fallbackViewer;
		}
	}

	return {
		authState,
		autumnState: {
			customer,
			_timeFetched: Date.now()
		},
		viewer
	};
}
