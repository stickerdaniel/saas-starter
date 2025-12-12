import type { LayoutServerLoad } from './$types';
import { api } from '$lib/convex/_generated/api.js';
import { createConvexHttpClient } from '@mmailaender/convex-better-auth-svelte/sveltekit';
import { redirect } from '@sveltejs/kit';
import type { BetterAuthUser } from '$lib/convex/admin/types';

export const load = (async (event) => {
	const client = createConvexHttpClient({ token: event.locals.token });

	const viewer = (await client.query(api.users.viewer, {})) as BetterAuthUser | null;

	// Redirect non-admins to app
	if (!viewer || viewer.role !== 'admin') {
		const lang = event.params.lang || 'en';
		redirect(307, `/${lang}/app`);
	}

	return {
		viewer
	};
}) satisfies LayoutServerLoad;
