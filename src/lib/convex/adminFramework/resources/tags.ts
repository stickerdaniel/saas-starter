import { v } from 'convex/values';
import { permissionMutation, permissionQuery, assertPermission } from '../access';
import {
	countArgsValidator,
	listArgsValidator,
	resolveLastPage,
	resolveLastPageArgsValidator,
	resolveLastPageForPaginatedQuery,
	countPaginatedQuery,
	runPaginatedListQuery,
	runResourceListQuery
} from '../utils/resource_query';
import { notFoundError, validationError } from '../utils/errors';
import {
	applyFieldVisibility,
	applyFieldVisibilityList,
	type FieldPolicy
} from '../utils/visibility';
import { assertResourceCrudAllowed } from '../utils/resource_guards';
import { aggregateCountTags } from '../utils/aggregates';
import { getResourceSearchIndexConfig } from '../utils/search_index';

type TagDoc = {
	_id: string;
	_creationTime: number;
	name: string;
	color: string;
	createdAt: number;
	updatedAt: number;
};

const tagFieldPolicies: FieldPolicy<TagDoc>[] = [
	{ attribute: 'name' },
	{ attribute: 'color' },
	{ attribute: 'createdAt' },
	{ attribute: 'updatedAt' }
];

const tagSearchIndex = getResourceSearchIndexConfig('demo-tags');

function matchesTagFilters(tag: { createdAt: number }, filters: Record<string, string>) {
	const createdRange = filters.createdRange;
	if (!createdRange || !createdRange.includes('..')) return true;
	const [startDate, endDate] = createdRange.split('..');
	const start = startDate ? new Date(startDate).getTime() : Number.NaN;
	const end = endDate ? new Date(endDate).getTime() : Number.NaN;
	if (!Number.isFinite(start) || !Number.isFinite(end)) return true;
	const endOfDay = end + 86_399_999;
	return tag.createdAt >= start && tag.createdAt <= endOfDay;
}

export const listTags = permissionQuery({
	args: listArgsValidator,
	handler: async (ctx, args) => {
		assertPermission(ctx.user, { resource: ['read'] });
		const search = args.search?.trim();
		const hasCreatedRange = Boolean(args.filters?.createdRange);
		const supportsIndexedSort = !args.sortBy || args.sortBy.field === 'name';

		if (!search && !hasCreatedRange && supportsIndexedSort) {
			const paginated = await runPaginatedListQuery({
				query: ctx.db.query('adminDemoTags').withIndex('by_name'),
				cursor: args.cursor,
				numItems: args.numItems,
				order: args.sortBy?.direction === 'desc' ? 'desc' : 'asc'
			});
			return {
				items: applyFieldVisibilityList({
					items: paginated.items as TagDoc[],
					user: ctx.user,
					policies: tagFieldPolicies
				}),
				continueCursor: paginated.continueCursor,
				isDone: paginated.isDone
			};
		}

		if (search && !hasCreatedRange && !args.sortBy) {
			const paginated = await runPaginatedListQuery({
				query: ctx.db
					.query('adminDemoTags')
					.withSearchIndex(tagSearchIndex.indexName, (q) =>
						q.search(tagSearchIndex.searchField, search)
					),
				cursor: args.cursor,
				numItems: args.numItems
			});
			return {
				items: applyFieldVisibilityList({
					items: paginated.items as TagDoc[],
					user: ctx.user,
					policies: tagFieldPolicies
				}),
				continueCursor: paginated.continueCursor,
				isDone: paginated.isDone
			};
		}

		const tags = await ctx.db.query('adminDemoTags').collect();
		const result = runResourceListQuery({
			items: tags,
			cursor: args.cursor,
			numItems: args.numItems,
			search,
			sortBy: args.sortBy,
			sortMap: {
				name: (item) => item.name,
				createdAt: (item) => item.createdAt
			},
			searchableValues: (item) => [item.name],
			applyFilters: (item) => matchesTagFilters(item, args.filters ?? {})
		});
		return {
			items: applyFieldVisibilityList({
				items: result.items as TagDoc[],
				user: ctx.user,
				policies: tagFieldPolicies
			}),
			continueCursor: result.continueCursor,
			isDone: result.isDone
		};
	}
});

export const countTags = permissionQuery({
	args: countArgsValidator,
	handler: async (ctx, args) => {
		assertPermission(ctx.user, { resource: ['read'] });
		const search = args.search?.trim();
		const hasCreatedRange = Boolean(args.filters?.createdRange);
		if (!search && !hasCreatedRange) {
			return countPaginatedQuery({
				createQuery: () => ctx.db.query('adminDemoTags').withIndex('by_name')
			});
		}
		if (search && !hasCreatedRange) {
			return countPaginatedQuery({
				createQuery: () =>
					ctx.db
						.query('adminDemoTags')
						.withSearchIndex(tagSearchIndex.indexName, (q) =>
							q.search(tagSearchIndex.searchField, search)
						)
			});
		}

		const tags = await ctx.db.query('adminDemoTags').collect();
		return runResourceListQuery({
			items: tags,
			numItems: tags.length || 1,
			search,
			searchableValues: (item) => [item.name],
			applyFilters: (item) => matchesTagFilters(item, args.filters ?? {})
		}).totalCount;
	}
});

export const resolveTagsLastPage = permissionQuery({
	args: resolveLastPageArgsValidator,
	handler: async (ctx, args) => {
		assertPermission(ctx.user, { resource: ['read'] });
		const search = args.search?.trim();
		const hasCreatedRange = Boolean(args.filters?.createdRange);
		const supportsIndexedSort = !args.sortBy || args.sortBy.field === 'name';
		if (!search && !hasCreatedRange && supportsIndexedSort) {
			return resolveLastPageForPaginatedQuery({
				createQuery: () => ctx.db.query('adminDemoTags').withIndex('by_name'),
				numItems: args.numItems,
				order: args.sortBy?.direction === 'desc' ? 'desc' : 'asc'
			});
		}
		if (search && !hasCreatedRange && !args.sortBy) {
			return resolveLastPageForPaginatedQuery({
				createQuery: () =>
					ctx.db
						.query('adminDemoTags')
						.withSearchIndex(tagSearchIndex.indexName, (q) =>
							q.search(tagSearchIndex.searchField, search)
						),
				numItems: args.numItems
			});
		}

		const tags = await ctx.db.query('adminDemoTags').collect();
		const totalCount = runResourceListQuery({
			items: tags,
			numItems: tags.length || 1,
			search,
			searchableValues: (item) => [item.name],
			applyFilters: (item) => matchesTagFilters(item, args.filters ?? {})
		}).totalCount;
		return resolveLastPage({ totalCount, numItems: args.numItems });
	}
});

export const getTagById = permissionQuery({
	args: { id: v.id('adminDemoTags') },
	handler: async (ctx, args) => {
		assertPermission(ctx.user, { resource: ['read'] });
		const tag = await ctx.db.get(args.id);
		if (!tag) notFoundError('Tag');
		return applyFieldVisibility({
			item: tag as TagDoc,
			user: ctx.user,
			policies: tagFieldPolicies
		});
	}
});

const tagValuesValidator = v.object({
	name: v.string(),
	color: v.string()
});

const tagUpdateValuesValidator = v.object({
	name: v.optional(v.string()),
	color: v.optional(v.string())
});

function validateTagValues(values: { name: string; color: string }) {
	const fieldErrors: Record<string, string> = {};
	if (values.name.trim().length === 0) {
		fieldErrors.name = 'admin.resources.form.required';
	}
	if (values.color.trim().length === 0) {
		fieldErrors.color = 'admin.resources.form.required';
	}
	if (Object.keys(fieldErrors).length > 0) {
		validationError(fieldErrors);
	}
}

export const createTag = permissionMutation({
	args: tagValuesValidator,
	handler: async (ctx, args) => {
		assertPermission(ctx.user, { resource: ['create'] });
		assertResourceCrudAllowed({
			resourceName: 'demo-tags',
			operation: 'create',
			user: ctx.user
		});
		validateTagValues(args);
		const now = Date.now();
		const id = await ctx.db.insert('adminDemoTags', {
			name: args.name,
			color: args.color,
			createdAt: now,
			updatedAt: now
		});
		return { id };
	}
});

export const updateTag = permissionMutation({
	args: { id: v.id('adminDemoTags'), values: tagUpdateValuesValidator },
	handler: async (ctx, args) => {
		assertPermission(ctx.user, { resource: ['update'] });
		const tag = await ctx.db.get(args.id);
		if (!tag) notFoundError('Tag');
		assertResourceCrudAllowed({
			resourceName: 'demo-tags',
			operation: 'update',
			user: ctx.user,
			record: tag as Record<string, unknown>
		});
		const nextValues = {
			name: args.values.name ?? tag.name,
			color: args.values.color ?? tag.color
		};
		validateTagValues(nextValues);
		await ctx.db.patch(args.id, {
			...nextValues,
			updatedAt: Date.now()
		});
		return { id: args.id };
	}
});

export const deleteTag = permissionMutation({
	args: { id: v.id('adminDemoTags') },
	handler: async (ctx, args) => {
		assertPermission(ctx.user, { resource: ['delete'] });
		const tag = await ctx.db.get(args.id);
		if (!tag) notFoundError('Tag');
		assertResourceCrudAllowed({
			resourceName: 'demo-tags',
			operation: 'delete',
			user: ctx.user,
			record: tag as Record<string, unknown>
		});

		const pivots = await ctx.db
			.query('adminDemoProjectTags')
			.withIndex('by_tag', (q) => q.eq('tagId', args.id))
			.collect();
		for (const pivot of pivots) {
			await ctx.db.delete(pivot._id);
		}
		await ctx.db.delete(args.id);
		return { id: args.id };
	}
});

export const restoreTag = permissionMutation({
	args: { id: v.id('adminDemoTags') },
	handler: async (ctx, args) => {
		assertPermission(ctx.user, { resource: ['update'] });
		assertResourceCrudAllowed({
			resourceName: 'demo-tags',
			operation: 'update',
			user: ctx.user
		});
		return { id: args.id };
	}
});

export const forceDeleteTag = permissionMutation({
	args: { id: v.id('adminDemoTags') },
	handler: async (ctx, args) => {
		assertPermission(ctx.user, { resource: ['delete'] });
		const tag = await ctx.db.get(args.id);
		if (!tag) notFoundError('Tag');
		assertResourceCrudAllowed({
			resourceName: 'demo-tags',
			operation: 'delete',
			user: ctx.user,
			record: tag as Record<string, unknown>
		});

		const pivots = await ctx.db
			.query('adminDemoProjectTags')
			.withIndex('by_tag', (q) => q.eq('tagId', args.id))
			.collect();
		for (const pivot of pivots) {
			await ctx.db.delete(pivot._id);
		}
		await ctx.db.delete(args.id);
		return { id: args.id };
	}
});

export const replicateTag = permissionMutation({
	args: { id: v.id('adminDemoTags') },
	handler: async (ctx, args) => {
		assertPermission(ctx.user, { resource: ['replicate'] });
		const tag = await ctx.db.get(args.id);
		if (!tag) notFoundError('Tag');
		assertResourceCrudAllowed({
			resourceName: 'demo-tags',
			operation: 'update',
			user: ctx.user,
			record: tag as Record<string, unknown>
		});
		const id = await ctx.db.insert('adminDemoTags', {
			name: `${tag.name} Copy`,
			color: tag.color,
			createdAt: Date.now(),
			updatedAt: Date.now()
		});
		return { id };
	}
});

export const runTagAction = permissionMutation({
	args: {
		action: v.union(v.literal('noop')),
		ids: v.array(v.id('adminDemoTags'))
	},
	handler: async (_ctx) => {
		return { type: 'message', text: 'admin.resources.toasts.action_success' };
	}
});

export const getTagMetrics = permissionQuery({
	args: {
		ranges: v.optional(v.record(v.string(), v.string()))
	},
	handler: async (ctx) => {
		assertPermission(ctx.user, { metric: ['read'] });
		let total: number;
		try {
			total = await aggregateCountTags(ctx);
		} catch (error) {
			const message = error instanceof Error ? error.message : '';
			if (message.includes('not been initialized') || message.includes('aggregate')) {
				const tags = await ctx.db.query('adminDemoTags').collect();
				total = tags.length;
			} else {
				throw error;
			}
		}
		return {
			cards: [{ key: 'total', type: 'value', value: total }]
		};
	}
});
