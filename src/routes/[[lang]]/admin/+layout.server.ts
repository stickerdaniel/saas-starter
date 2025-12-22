import type { LayoutServerLoad } from './$types';

// Role check now happens in hooks.server.ts - must spread parent to preserve viewer data
export const load = (async ({ parent }) => {
	const parentData = await parent();
	return {
		...parentData
	};
}) satisfies LayoutServerLoad;
