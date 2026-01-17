import type { PageServerLoad } from './$types';

export const load = (async () => {
	// Notification recipients are loaded client-side via useQuery for real-time updates
	return {};
}) satisfies PageServerLoad;
