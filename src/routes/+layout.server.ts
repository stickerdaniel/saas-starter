import type { LayoutServerLoad } from './$types';
import {
	resolveAuthLayoutData,
	resolvePublicAuthLayoutData,
	usesPublicAuthSnapshot
} from '$lib/server/auth-layout-data';

export const load: LayoutServerLoad = async (event) => {
	// Negotiated marketing pages remain independent from Convex and Autumn. They
	// use the verified JWT for first paint; /app and /admin resolve live backend
	// data through their own layout loads.
	const authData = usesPublicAuthSnapshot(event.route.id)
		? resolvePublicAuthLayoutData(event)
		: await resolveAuthLayoutData(event);

	return {
		...authData,
		// Persisted sidebar state (set by handleSidebarState in hooks.server.ts).
		// Forwarded to Sidebar.Provider so the authenticated shell renders the
		// correct open/collapsed state on first paint.
		sidebarOpen: event.locals.sidebarOpen
	};
};
