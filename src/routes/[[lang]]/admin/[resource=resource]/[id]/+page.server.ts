import { error } from '@sveltejs/kit';
import { createConvexHttpClient } from '@mmailaender/convex-better-auth-svelte/sveltekit';
import { getResourceRuntime } from '$lib/admin/registry';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	const runtime = getResourceRuntime(event.params.resource ?? '');
	if (!runtime) throw error(404, 'Resource not found');

	const client = createConvexHttpClient({ token: event.locals.token });
	const record = await client.query(runtime.getById, { id: event.params.id } as never);
	if (!record) throw error(404, 'Record not found');

	return { record };
};
