import type { PageServerLoad } from './$types';

export const load = (async ({ parent }) => {
	const { viewer } = await parent();
	return {
		user: viewer
			? {
					name: viewer.name ?? undefined,
					email: viewer.email ?? undefined,
					image: viewer.image ?? null,
					emailVerified: 'emailVerified' in viewer ? viewer.emailVerified : false
				}
			: null
	};
}) satisfies PageServerLoad;
