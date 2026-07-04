import type { LayoutServerLoad } from './$types';
import { resolveAuthLayoutData } from '$lib/server/auth-layout-data';

export const load: LayoutServerLoad = async (event) => {
	// On prerendered marketing pages this resolves at build time without a
	// cookie and freezes as unauthenticated. The /app and /admin layout loads
	// re-resolve the same keys fresh (see $lib/server/auth-layout-data).
	const authData = await resolveAuthLayoutData(event);

	return {
		...authData,
		// Persisted sidebar state (set by handleSidebarState in hooks.server.ts).
		// Forwarded to Sidebar.Provider so the authenticated shell renders the
		// correct open/collapsed state on first paint.
		sidebarOpen: event.locals.sidebarOpen
	};
};
