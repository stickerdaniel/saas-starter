import type { LayoutServerLoad } from './$types';
import { resolveAuthLayoutData, resolvePublicAuthLayoutData } from '$lib/server/auth-layout-data';

export const load: LayoutServerLoad = async (event) => {
	// The hook classifies public routes without making this load depend on
	// the request route. Pricing and authenticated subtrees refresh backend state in
	// their own loads when client navigation retains a public root snapshot.
	const authData = event.locals.publicAuthSnapshot
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
