import type { LayoutServerLoad } from './$types';
import { resolveAuthLayoutData } from '$lib/server/auth-layout-data';

/**
 * Overrides the root layout's auth-coupled data (authState, viewer,
 * autumnState, sidebarOpen) for the /app subtree when the root data is the
 * frozen prerendered snapshot.
 *
 * Marketing pages prerender the root layout with a build-time unauthenticated
 * snapshot (viewer null). SvelteKit never reruns a parent server load on
 * client-side navigation (sveltejs/kit#4426) and invalidate() on a prerendered
 * route fetches the static __data.json, so entering /app via a client-side
 * navigation from a marketing page kept the frozen viewer and dead-ended in
 * AuthConnectionFallback ("Connecting...") until a manual reload.
 *
 * Only client-side navigation hits the frozen data. A full document load
 * (isDataRequest false) runs the whole layout chain server-side, so the root
 * layout already resolves a live session against the request cookie and is
 * authoritative; this load defers to it to avoid resolving the auth block
 * (an external Autumn call plus a Convex query) a second time. On a data
 * request (isDataRequest true) the client keeps its frozen root snapshot and
 * only the newly entered subtree loads run, so this load resolves fresh.
 */
export const load: LayoutServerLoad = async (event) => {
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
