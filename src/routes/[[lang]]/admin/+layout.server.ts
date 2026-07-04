import type { LayoutServerLoad } from './$types';
import { resolveAuthLayoutData } from '$lib/server/auth-layout-data';

/**
 * Overrides the frozen root layout auth data for the /admin subtree on a
 * client-side navigation from a prerendered marketing page, deferring to the
 * root's resolution on a full document load. See
 * src/routes/[[lang]]/app/+layout.server.ts and $lib/server/auth-layout-data
 * for the full rationale.
 */
export const load: LayoutServerLoad = async (event) => {
	event.depends('app:auth');
	event.depends('autumn:customer');

	if (!event.isDataRequest) {
		return {};
	}

	return {
		...(await resolveAuthLayoutData(event)),
		sidebarOpen: event.locals.sidebarOpen
	};
};
