import { createConvexHttpClient } from '@mmailaender/convex-better-auth-svelte/sveltekit';
import { getResourceByName, getResourceRuntime } from '$lib/admin/registry';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	const runtime = getResourceRuntime(event.params.resource ?? '');
	const resource = getResourceByName(event.params.resource ?? '');
	if (!runtime || !resource) return { metricsCards: [] };

	const metrics = resource.metrics ?? [];
	if (metrics.length === 0) return { metricsCards: [] };

	const ranges = Object.fromEntries(
		metrics
			.filter((m) => (m.rangeOptions?.length ?? 0) > 0)
			.map((m) => [m.key, m.rangeOptions?.[0]?.value ?? ''])
	);

	try {
		const client = createConvexHttpClient({ token: event.locals.token });
		const result = (await client.query(runtime.getMetrics, { ranges } as never)) as {
			cards?: Array<Record<string, unknown>>;
		};
		return { metricsCards: result.cards ?? [] };
	} catch (error) {
		console.error(`[admin:${resource.name}] SSR metrics failed`, error);
		return { metricsCards: [] };
	}
};
