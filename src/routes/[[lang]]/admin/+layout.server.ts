import type { LayoutServerLoad } from './$types';

// Role check now happens in hooks.server.ts - no await needed here
export const load = (async () => {
	return {};
}) satisfies LayoutServerLoad;
