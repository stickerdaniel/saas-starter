import { v } from 'convex/values';
import { permissionQuery } from './access';
import { RESOURCE_SEARCH_INDEXES } from './utils/search_index';
import { isResourceReadAllowed } from './utils/resource_guards';

const DEFAULT_LIMIT = 5;

export const globalSearch = permissionQuery({
	args: {
		search: v.string(),
		resourceLimits: v.optional(v.record(v.string(), v.number()))
	},
	handler: async (ctx, args) => {
		const trimmed = args.search.trim();
		if (trimmed.length < 2) return [];

		const configs = Object.values(RESOURCE_SEARCH_INDEXES).filter((config) =>
			isResourceReadAllowed({ resourceName: config.resourceName, user: ctx.user })
		);

		const results = await Promise.allSettled(
			configs.map(async (config) => {
				const limit = args.resourceLimits?.[config.resourceName] ?? DEFAULT_LIMIT;

				const query = (ctx.db as any)
					.query(config.table)
					.withSearchIndex(config.indexName, (q: any) => {
						const base = q.search(config.searchField, trimmed);
						if (config.softDeletes) {
							return base.eq('deletedAt', undefined);
						}
						return base;
					});

				const items = await query.take(limit);
				return {
					resourceName: config.resourceName,
					items: items as Array<Record<string, unknown>>
				};
			})
		);

		return results.map((result, i) => {
			if (result.status === 'fulfilled') {
				return result.value;
			}
			return {
				resourceName: configs[i].resourceName,
				items: [] as Array<Record<string, unknown>>,
				error: true
			};
		});
	}
});
