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
 * Per-request memo for the resolved auth block, keyed on `event.locals` (one
 * object per HTTP request, shared by every server load in it).
 *
 * Without it the block can resolve more than once per data request into an
 * authed subtree: the subtree layout resolves it, AND `await parent()` in any
 * nested load force-runs the root layout load server-side even though its
 * node is skipped in the response, firing the Autumn call and Convex query a
 * second time. The WeakMap is module-level but keyed per request, so nothing
 * leaks across requests.
 */
const authDataPerRequest = new WeakMap<
	App.Locals,
	ReturnType<typeof resolveAuthLayoutDataUncached>
>();

/**
 * Resolves the auth-coupled layout data (authState, viewer, autumnState) for a
 * server load, at most once per HTTP request. Shared by the root layout
 * (marketing/auth SSR) and the /app and /admin layouts.
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
 * cookie (see authedSubtreeLayoutLoad below).
 */
export async function resolveAuthLayoutData(event: ServerLoadEvent) {
	// Deps are registered outside the memo so every calling load attaches them
	// to its own node.
	// Enables targeted invalidation via invalidate('autumn:customer') to refetch only customer data
	event.depends('autumn:customer');
	// Enables targeted invalidation when client-side auth state diverges from server state.
	// Prerendered pages bake authState.isAuthenticated: false at build time — when the client
	// recovers a session from cookies, AppAuthProvider detects the mismatch and calls
	// invalidate('app:auth') to re-run this load with fresh cookies.
	event.depends('app:auth');

	const memoized = authDataPerRequest.get(event.locals);
	if (memoized) return memoized;

	// Store the promise (not the awaited value) so concurrent loads in the same
	// request share one in-flight resolution instead of racing to create two.
	const pending = resolveAuthLayoutDataUncached(event);
	authDataPerRequest.set(event.locals, pending);
	return pending;
}

async function resolveAuthLayoutDataUncached(event: ServerLoadEvent) {
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

/**
 * Layout load for the authenticated top-level subtrees. /app and /admin
 * re-export this single function so their guard logic cannot silently diverge
 * (scripts/authenticated-subtree-layouts.test.ts pins the re-export).
 *
 * Overrides the root layout's auth-coupled data (authState, viewer,
 * autumnState, sidebarOpen) for the subtree when the root data is the frozen
 * prerendered snapshot: entering /app via a client-side navigation from a
 * marketing page kept the frozen viewer and dead-ended in
 * AuthConnectionFallback ("Connecting...") until a manual reload.
 *
 * Only client-side navigation hits the frozen data. A full document load
 * (isDataRequest false) runs the whole layout chain server-side, so the root
 * layout already resolves a live session against the request cookie and is
 * authoritative; this load defers to it. On a data request (isDataRequest
 * true) the client keeps its frozen root snapshot and only the newly entered
 * subtree loads run, so this load resolves fresh (deduplicated per request by
 * the memo in resolveAuthLayoutData).
 */
export const authedSubtreeLayoutLoad = async (event: ServerLoadEvent) => {
	// Register the invalidation deps unconditionally so invalidate('app:auth')
	// and invalidate('autumn:customer') rerun this load even on the full-load
	// path where it defers to the root without resolving.
	event.depends('app:auth');
	event.depends('autumn:customer');

	if (!event.isDataRequest) {
		// Full document load: the root layout ran with the cookie and is the
		// authoritative source for the inlined page data.
		return {};
	}

	// Client-side navigation: the root data is the frozen prerendered snapshot
	// (or a stale reused one), so resolve fresh against the live cookie here.
	return {
		...(await resolveAuthLayoutData(event)),
		sidebarOpen: event.locals.sidebarOpen
	};
};
