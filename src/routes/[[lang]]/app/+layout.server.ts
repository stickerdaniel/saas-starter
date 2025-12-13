import type { LayoutServerLoad } from './$types';

// Viewer data is inherited from root layout - no fetch needed here
export const load = (async () => {
	return {};
}) satisfies LayoutServerLoad;
