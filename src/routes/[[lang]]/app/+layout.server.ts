import type { LayoutServerLoad } from './$types';

// Viewer data is inherited from root layout - must spread parent to preserve it
export const load = (async ({ parent }) => {
	const parentData = await parent();
	return {
		...parentData
	};
}) satisfies LayoutServerLoad;
