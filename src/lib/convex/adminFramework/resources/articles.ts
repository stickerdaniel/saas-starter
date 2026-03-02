import { v } from 'convex/values';
import type { Doc } from '../../_generated/dataModel';
import type { QueryCtx } from '../../_generated/server';
import { permissionMutation, permissionQuery, assertPermission } from '../access';
import {
	countArgsValidator,
	listArgsValidator,
	matchesCreatedRange,
	resolveLastPage,
	resolveLastPageArgsValidator,
	countPaginatedQuery,
	resolveLastPageForPaginatedQuery,
	runPaginatedListQuery,
	runResourceListQuery
} from '../utils/resource_query';
import { success, type ActionResponse, notFoundError, validationError } from '../utils/errors';
import {
	applyFieldVisibility,
	applyFieldVisibilityList,
	type FieldPolicy
} from '../utils/visibility';
import { assertResourceCrudAllowed, assertResourceReadAllowed } from '../utils/resource_guards';
import {
	aggregateCountLiveArticles,
	aggregateCountArticlesByStatus,
	aggregateCountTrashedArticles
} from '../utils/aggregates';
import { getResourceSearchIndexConfig } from '../utils/search_index';

export type AdminDemoArticle = Doc<'adminDemoArticles'>;

const articleFieldPolicies: FieldPolicy<AdminDemoArticle>[] = [
	{ attribute: 'title' },
	{ attribute: 'slug' },
	{ attribute: 'authorAvatarUrl' },
	{ attribute: 'authorName' },
	{ attribute: 'websiteUrl' },
	{ attribute: 'apiKey' },
	{ attribute: 'category' },
	{ attribute: 'priority' },
	{ attribute: 'status' },
	{ attribute: 'price' },
	{ attribute: 'isPublished' },
	{ attribute: 'publishedAt' },
	{ attribute: 'body' },
	{ attribute: 'tags' },
	{ attribute: 'permissions' },
	{ attribute: 'metadata' },
	{ attribute: 'internalRef' },
	{ attribute: 'createdAt' },
	{ attribute: 'updatedAt' }
];

const articleSearchIndex = getResourceSearchIndexConfig('demo-articles');

function matchesArticleFilters(article: AdminDemoArticle, filters: Record<string, string>) {
	const status = filters.status;
	if (status && status !== 'all' && article.status !== status) return false;

	const category = filters.category;
	if (category && category !== 'all' && article.category !== category) return false;

	if (!matchesCreatedRange(article.createdAt, filters.createdRange)) return false;

	return true;
}

function matchesArticleLens(article: AdminDemoArticle, lens: string | undefined) {
	if (!lens) return true;
	if (lens === 'published') return article.status === 'published';
	if (lens === 'drafts') return article.status === 'draft';
	return true;
}

function resolveArticleStatus(filters: Record<string, string>, lens?: string) {
	const status = filters.status;
	if (status && status !== 'all') return status;
	if (lens === 'published') return 'published';
	if (lens === 'drafts') return 'draft';
	return undefined;
}

function getArticleSearchQuery(
	ctx: QueryCtx,
	args: {
		search?: string;
		sortBy?: { field: string; direction: string };
		filters?: Record<string, string>;
		trashed?: 'without' | 'with' | 'only';
		lens?: string;
	}
) {
	const search = args.search?.trim();
	if (!search || args.sortBy) return null;
	if (args.filters?.createdRange ?? '') return null;
	if (args.filters?.category && args.filters.category !== 'all') return null;
	if ((args.trashed ?? 'without') !== 'without' && (args.trashed ?? 'without') !== 'with')
		return null;

	const status = resolveArticleStatus(args.filters ?? {}, args.lens);
	return ctx.db
		.query('adminDemoArticles')
		.withSearchIndex(articleSearchIndex.indexName, (q: any) => {
			let query = q.search(articleSearchIndex.searchField, search);
			if (status) query = query.eq('status', status);
			if ((args.trashed ?? 'without') === 'without') query = query.eq('deletedAt', undefined);
			return query;
		});
}

function getIndexedArticleQuery(
	ctx: QueryCtx,
	args: {
		filters?: Record<string, string>;
		lens?: string;
		trashed?: 'without' | 'with' | 'only';
	}
) {
	const filters = args.filters ?? {};
	if (filters.createdRange) return null;
	if (filters.category && filters.category !== 'all') return null;

	const status = resolveArticleStatus(filters, args.lens);
	if (status && (args.trashed ?? 'without') !== 'with') return null;
	if (status) {
		return ctx.db
			.query('adminDemoArticles')
			.withIndex('by_status', (q) => q.eq('status', status as any));
	}

	if (args.trashed === 'only') {
		return ctx.db.query('adminDemoArticles').withIndex('by_deleted', (q) => q.gt('deletedAt', 0));
	}
	if (args.trashed === 'without') {
		return ctx.db
			.query('adminDemoArticles')
			.withIndex('by_deleted', (q) => q.eq('deletedAt', undefined));
	}
	return ctx.db.query('adminDemoArticles');
}

export const listArticles = permissionQuery({
	args: listArgsValidator,
	handler: async (ctx, args) => {
		assertPermission(ctx.user, { resource: ['read'] });
		assertResourceReadAllowed({ resourceName: 'demo-articles', user: ctx.user });
		const search = args.search?.trim();
		const indexedQuery = getIndexedArticleQuery(ctx, {
			filters: args.filters,
			lens: args.lens,
			trashed: args.trashed
		});
		if (!search && indexedQuery && !args.sortBy) {
			const paginated = await runPaginatedListQuery({
				query: indexedQuery,
				cursor: args.cursor,
				numItems: args.numItems
			});
			return {
				items: applyFieldVisibilityList({
					items: paginated.items as AdminDemoArticle[],
					user: ctx.user,
					policies: articleFieldPolicies
				}),
				continueCursor: paginated.continueCursor,
				isDone: paginated.isDone
			};
		}

		const searchQuery = getArticleSearchQuery(ctx, args);
		if (searchQuery) {
			const paginated = await runPaginatedListQuery({
				query: searchQuery,
				cursor: args.cursor,
				numItems: args.numItems
			});
			return {
				items: applyFieldVisibilityList({
					items: paginated.items as AdminDemoArticle[],
					user: ctx.user,
					policies: articleFieldPolicies
				}),
				continueCursor: paginated.continueCursor,
				isDone: paginated.isDone
			};
		}

		const articles = await ctx.db.query('adminDemoArticles').collect();
		const result = runResourceListQuery({
			items: articles,
			cursor: args.cursor,
			numItems: args.numItems,
			search,
			trashed: args.trashed,
			sortBy: args.sortBy,
			sortMap: {
				title: (item) => item.title,
				status: (item) => item.status,
				category: (item) => item.category,
				price: (item) => item.price,
				createdAt: (item) => item.createdAt,
				updatedAt: (item) => item.updatedAt
			},
			searchableValues: (item) => [item.title, item.authorName, item.slug],
			applyFilters: (item) => matchesArticleFilters(item, args.filters ?? {}),
			applyLens: (item) => matchesArticleLens(item, args.lens)
		});

		return {
			items: applyFieldVisibilityList({
				items: result.items,
				user: ctx.user,
				policies: articleFieldPolicies
			}),
			continueCursor: result.continueCursor,
			isDone: result.isDone
		};
	}
});

export const countArticles = permissionQuery({
	args: countArgsValidator,
	handler: async (ctx, args) => {
		assertPermission(ctx.user, { resource: ['read'] });
		assertResourceReadAllowed({ resourceName: 'demo-articles', user: ctx.user });

		// Fast path: O(log n) aggregate for unfiltered counts
		const search = args.search?.trim();
		const filters = args.filters ?? {};
		const trashed = args.trashed ?? 'without';
		const hasActiveFilters =
			(filters.status && filters.status !== 'all') ||
			(filters.category && filters.category !== 'all') ||
			Boolean(filters.createdRange);
		if (!search && !hasActiveFilters && !args.lens) {
			if (trashed === 'without') return aggregateCountLiveArticles(ctx);
			if (trashed === 'only') return aggregateCountTrashedArticles(ctx);
		}

		const indexedQuery = getIndexedArticleQuery(ctx, {
			filters: args.filters,
			lens: args.lens,
			trashed: args.trashed
		});
		if (!search && indexedQuery) {
			return countPaginatedQuery({
				createQuery: () =>
					getIndexedArticleQuery(ctx, {
						filters: args.filters,
						lens: args.lens,
						trashed: args.trashed
					}) as any
			});
		}

		const searchQuery = getArticleSearchQuery(ctx, args);
		if (searchQuery) {
			return countPaginatedQuery({
				createQuery: () => getArticleSearchQuery(ctx, args) as any
			});
		}

		const articles = await ctx.db.query('adminDemoArticles').collect();
		return runResourceListQuery({
			items: articles,
			numItems: articles.length || 1,
			search,
			trashed: args.trashed,
			searchableValues: (item) => [item.title, item.authorName, item.slug],
			applyFilters: (item) => matchesArticleFilters(item, args.filters ?? {}),
			applyLens: (item) => matchesArticleLens(item, args.lens)
		}).totalCount;
	}
});

export const resolveArticlesLastPage = permissionQuery({
	args: resolveLastPageArgsValidator,
	handler: async (ctx, args) => {
		assertPermission(ctx.user, { resource: ['read'] });
		assertResourceReadAllowed({ resourceName: 'demo-articles', user: ctx.user });
		const search = args.search?.trim();
		const indexedQuery = getIndexedArticleQuery(ctx, {
			filters: args.filters,
			lens: args.lens,
			trashed: args.trashed
		});
		if (!search && indexedQuery && !args.sortBy) {
			return resolveLastPageForPaginatedQuery({
				createQuery: () =>
					getIndexedArticleQuery(ctx, {
						filters: args.filters,
						lens: args.lens,
						trashed: args.trashed
					}) as any,
				numItems: args.numItems
			});
		}

		const searchQuery = getArticleSearchQuery(ctx, args);
		if (searchQuery) {
			return resolveLastPageForPaginatedQuery({
				createQuery: () => getArticleSearchQuery(ctx, args) as any,
				numItems: args.numItems
			});
		}

		const articles = await ctx.db.query('adminDemoArticles').collect();
		const totalCount = runResourceListQuery({
			items: articles,
			numItems: articles.length || 1,
			search,
			trashed: args.trashed,
			searchableValues: (item) => [item.title, item.authorName, item.slug],
			applyFilters: (item) => matchesArticleFilters(item, args.filters ?? {}),
			applyLens: (item) => matchesArticleLens(item, args.lens)
		}).totalCount;
		return resolveLastPage({ totalCount, numItems: args.numItems });
	}
});

export const getArticleById = permissionQuery({
	args: { id: v.id('adminDemoArticles') },
	handler: async (ctx, args) => {
		assertPermission(ctx.user, { resource: ['read'] });
		assertResourceReadAllowed({ resourceName: 'demo-articles', user: ctx.user });
		const article = await ctx.db.get(args.id);
		if (!article) notFoundError('Article');
		return applyFieldVisibility({
			item: article as AdminDemoArticle,
			user: ctx.user,
			policies: articleFieldPolicies
		});
	}
});

const createArticleValuesValidator = v.object({
	title: v.string(),
	slug: v.string(),
	authorAvatarUrl: v.optional(v.string()),
	authorName: v.string(),
	websiteUrl: v.optional(v.string()),
	apiKey: v.optional(v.string()),
	category: v.string(),
	priority: v.optional(v.array(v.string())),
	status: v.string(),
	price: v.number(),
	isPublished: v.boolean(),
	publishedAt: v.optional(v.number()),
	body: v.optional(v.string()),
	tags: v.optional(v.array(v.string())),
	permissions: v.optional(v.any()),
	metadata: v.optional(v.any()),
	internalRef: v.optional(v.string())
});

const updateArticleValuesValidator = v.object({
	title: v.optional(v.string()),
	slug: v.optional(v.string()),
	authorAvatarUrl: v.optional(v.string()),
	authorName: v.optional(v.string()),
	websiteUrl: v.optional(v.string()),
	apiKey: v.optional(v.string()),
	category: v.optional(v.string()),
	priority: v.optional(v.array(v.string())),
	status: v.optional(v.string()),
	price: v.optional(v.number()),
	isPublished: v.optional(v.boolean()),
	publishedAt: v.optional(v.number()),
	body: v.optional(v.string()),
	tags: v.optional(v.array(v.string())),
	permissions: v.optional(v.any()),
	metadata: v.optional(v.any()),
	internalRef: v.optional(v.string())
});

function validateArticleValues(values: { title: string; slug: string; authorName: string }) {
	const fieldErrors: Record<string, string> = {};
	if (values.title.trim().length === 0) {
		fieldErrors.title = 'admin.resources.form.required';
	}
	if (values.slug.trim().length === 0) {
		fieldErrors.slug = 'admin.resources.form.required';
	}
	if (values.authorName.trim().length === 0) {
		fieldErrors.authorName = 'admin.resources.form.required';
	}
	if (Object.keys(fieldErrors).length > 0) {
		validationError(fieldErrors);
	}
}

export const createArticle = permissionMutation({
	args: createArticleValuesValidator,
	handler: async (ctx, args) => {
		assertPermission(ctx.user, { resource: ['create'] });
		assertResourceCrudAllowed({
			resourceName: 'demo-articles',
			operation: 'create',
			user: ctx.user
		});
		validateArticleValues(args);
		const now = Date.now();
		const id = await ctx.db.insert('adminDemoArticles', {
			title: args.title,
			slug: args.slug,
			authorAvatarUrl: args.authorAvatarUrl,
			authorName: args.authorName,
			websiteUrl: args.websiteUrl,
			apiKey: args.apiKey,
			category: args.category,
			priority: args.priority,
			status: args.status,
			price: args.price,
			isPublished: args.isPublished,
			publishedAt: args.publishedAt,
			body: args.body,
			tags: args.tags,
			permissions: args.permissions,
			metadata: args.metadata,
			internalRef: args.internalRef,
			createdAt: now,
			updatedAt: now
		});
		return { id };
	}
});

export const updateArticle = permissionMutation({
	args: { id: v.id('adminDemoArticles'), values: updateArticleValuesValidator },
	handler: async (ctx, args) => {
		assertPermission(ctx.user, { resource: ['update'] });
		const article = await ctx.db.get(args.id);
		if (!article) notFoundError('Article');
		assertResourceCrudAllowed({
			resourceName: 'demo-articles',
			operation: 'update',
			user: ctx.user,
			record: article as Record<string, unknown>
		});
		const nextValues = {
			title: args.values.title ?? article.title,
			slug: args.values.slug ?? article.slug,
			authorName: args.values.authorName ?? article.authorName
		};
		validateArticleValues(nextValues);
		await ctx.db.patch(args.id, {
			...args.values,
			updatedAt: Date.now()
		});
		return { id: args.id };
	}
});

export const deleteArticle = permissionMutation({
	args: { id: v.id('adminDemoArticles') },
	handler: async (ctx, args) => {
		assertPermission(ctx.user, { resource: ['delete'] });
		const article = await ctx.db.get(args.id);
		if (!article) notFoundError('Article');
		assertResourceCrudAllowed({
			resourceName: 'demo-articles',
			operation: 'delete',
			user: ctx.user,
			record: article as Record<string, unknown>
		});
		await ctx.db.patch(args.id, { deletedAt: Date.now(), updatedAt: Date.now() });
		return { id: args.id };
	}
});

export const restoreArticle = permissionMutation({
	args: { id: v.id('adminDemoArticles') },
	handler: async (ctx, args) => {
		assertPermission(ctx.user, { resource: ['restore'] });
		const article = await ctx.db.get(args.id);
		if (!article) notFoundError('Article');
		assertResourceCrudAllowed({
			resourceName: 'demo-articles',
			operation: 'delete',
			user: ctx.user,
			record: article as Record<string, unknown>
		});
		await ctx.db.patch(args.id, { deletedAt: undefined, updatedAt: Date.now() });
		return { id: args.id };
	}
});

export const forceDeleteArticle = permissionMutation({
	args: { id: v.id('adminDemoArticles') },
	handler: async (ctx, args) => {
		assertPermission(ctx.user, { resource: ['force-delete'] });
		const article = await ctx.db.get(args.id);
		if (!article) notFoundError('Article');
		assertResourceCrudAllowed({
			resourceName: 'demo-articles',
			operation: 'delete',
			user: ctx.user,
			record: article as Record<string, unknown>
		});
		await ctx.db.delete(args.id);
		return { id: args.id };
	}
});

export const replicateArticle = permissionMutation({
	args: { id: v.id('adminDemoArticles') },
	handler: async (ctx, args) => {
		assertPermission(ctx.user, { resource: ['replicate'] });
		const article = await ctx.db.get(args.id);
		if (!article) notFoundError('Article');
		assertResourceCrudAllowed({
			resourceName: 'demo-articles',
			operation: 'update',
			user: ctx.user,
			record: article as Record<string, unknown>
		});
		const now = Date.now();
		ctx._auditState.hint = { event: 'Replicate', original: article as Record<string, unknown> };
		const id = await ctx.db.insert('adminDemoArticles', {
			title: `${article.title} (Copy)`,
			slug: `${article.slug}-copy-${now}`,
			authorAvatarUrl: article.authorAvatarUrl,
			authorName: article.authorName,
			websiteUrl: article.websiteUrl,
			apiKey: article.apiKey,
			category: article.category,
			priority: article.priority,
			status: 'draft',
			price: article.price,
			isPublished: false,
			body: article.body,
			tags: article.tags,
			permissions: article.permissions,
			metadata: article.metadata,
			internalRef: article.internalRef,
			createdAt: now,
			updatedAt: now
		});
		return { id };
	}
});

const articleActionValidator = v.union(v.literal('publish'), v.literal('unpublish'));

export const runArticleAction = permissionMutation({
	args: {
		action: articleActionValidator,
		ids: v.array(v.id('adminDemoArticles')),
		values: v.optional(v.record(v.string(), v.any()))
	},
	handler: async (ctx, args): Promise<ActionResponse> => {
		assertPermission(ctx.user, { action: ['run'] });
		if (args.ids.length === 0)
			return { type: 'danger', text: 'admin.resources.actions.no_records_selected' };

		const chunkSize = args.action === 'unpublish' ? 5 : args.ids.length;
		const idsToProcess = args.ids.slice(0, chunkSize);
		const batchId = crypto.randomUUID();

		let skipped = 0;
		for (const id of idsToProcess) {
			const article = await ctx.db.get(id);
			if (!article) {
				skipped++;
				continue;
			}
			ctx._auditState.hint = { event: 'Action', actionName: args.action, batchId };
			if (args.action === 'publish') {
				await ctx.db.patch(id, {
					status: 'published',
					isPublished: true,
					publishedAt: Date.now(),
					updatedAt: Date.now()
				});
			} else {
				await ctx.db.patch(id, {
					status: 'draft',
					isPublished: false,
					updatedAt: Date.now()
				});
			}
		}
		if (skipped > 0 && skipped === idsToProcess.length) {
			return { type: 'danger', text: 'admin.resources.actions.records_not_found' };
		}
		return success('admin.resources.toasts.action_success');
	}
});

export const getArticleMetrics = permissionQuery({
	args: {
		ranges: v.optional(v.record(v.string(), v.string()))
	},
	handler: async (ctx) => {
		assertPermission(ctx.user, { metric: ['read'] });
		assertResourceReadAllowed({ resourceName: 'demo-articles', user: ctx.user });
		const [totalCount, publishedCount] = await Promise.all([
			aggregateCountLiveArticles(ctx),
			aggregateCountArticlesByStatus(ctx, 'published')
		]);
		return {
			cards: [
				{ key: 'total', type: 'value', value: totalCount },
				{
					key: 'publishedRate',
					type: 'progress',
					value: publishedCount,
					target: Math.max(totalCount, 1)
				}
			]
		};
	}
});

export const listArticleOptions = permissionQuery({
	args: {},
	handler: async (ctx) => {
		assertPermission(ctx.user, { resource: ['read'] });
		assertResourceReadAllowed({ resourceName: 'demo-articles', user: ctx.user });
		const articles = await ctx.db.query('adminDemoArticles').collect();
		return articles
			.filter((a) => a.deletedAt === undefined)
			.map((a) => ({
				value: a._id,
				label: a.title
			}));
	}
});
