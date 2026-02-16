import { v } from 'convex/values';
import type { Doc } from '../../_generated/dataModel';
import { permissionMutation, permissionQuery, assertPermission } from '../access';
import {
	countArgsValidator,
	listArgsValidator,
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
import { toMorphIndexFields } from '../utils/morph_to';
import { assertResourceCrudAllowed } from '../utils/resource_guards';
import { aggregateCountCommentsByTarget, aggregateCountLiveComments } from '../utils/aggregates';
import { getResourceSearchIndexConfig } from '../utils/search_index';

export type AdminDemoComment = Doc<'adminDemoComments'>;

type CommentListItem = AdminDemoComment & {
	targetTitle: string;
	targetKind: 'project' | 'task';
};

const commentFieldPolicies: FieldPolicy<CommentListItem>[] = [
	{ attribute: 'text' },
	{
		attribute: 'authorEmail',
		canSee: (_user, item) => item.targetKind === 'project'
	},
	{ attribute: 'target' },
	{ attribute: 'targetKind' },
	{ attribute: 'targetTitle' },
	{ attribute: 'createdAt' },
	{ attribute: 'updatedAt' }
];

const commentSearchIndex = getResourceSearchIndexConfig('demo-comments');

async function resolveCommentTarget(ctx: any, comment: AdminDemoComment) {
	if (comment.target.kind === 'project') {
		const project = await ctx.db.get(comment.target.id);
		if (!project) return { kind: 'project' as const, title: 'Deleted project' };
		return { kind: 'project' as const, title: project.name };
	}
	const task = await ctx.db.get(comment.target.id);
	if (!task) return { kind: 'task' as const, title: 'Deleted task' };
	return { kind: 'task' as const, title: task.title };
}

function resolvedTargetKind(filters: Record<string, string>, lens?: string) {
	if (filters.targetKind && filters.targetKind !== 'all') return filters.targetKind;
	if (lens === 'project' || lens === 'task') return lens;
	return undefined;
}

function matchesCommentLens(comment: AdminDemoComment, lens: string | undefined) {
	if (!lens) return true;
	if (lens === 'project') return comment.target.kind === 'project';
	if (lens === 'task') return comment.target.kind === 'task';
	return true;
}

function matchesCommentFilters(comment: AdminDemoComment, filters: Record<string, string>) {
	if (
		filters.targetKind &&
		filters.targetKind !== 'all' &&
		comment.target.kind !== filters.targetKind
	) {
		return false;
	}
	const createdRange = filters.createdRange;
	if (createdRange && createdRange.includes('..')) {
		const [startDate, endDate] = createdRange.split('..');
		const start = startDate ? new Date(startDate).getTime() : Number.NaN;
		const end = endDate ? new Date(endDate).getTime() : Number.NaN;
		if (Number.isFinite(start) && Number.isFinite(end)) {
			const endOfDay = end + 86_399_999;
			if (comment.createdAt < start || comment.createdAt > endOfDay) {
				return false;
			}
		}
	}
	return true;
}

function targetIndexFields(target: AdminDemoComment['target']) {
	return toMorphIndexFields(target, {
		project: 'targetProjectId',
		task: 'targetTaskId'
	});
}

async function hydrateCommentRows(rows: AdminDemoComment[], ctx: any): Promise<CommentListItem[]> {
	return Promise.all(
		rows.map(async (comment) => {
			const target = await resolveCommentTarget(ctx, comment);
			return {
				...comment,
				targetKind: target.kind,
				targetTitle: target.title
			};
		})
	);
}

function getIndexedCommentQuery(
	ctx: any,
	args: {
		filters?: Record<string, string>;
		lens?: string;
		trashed?: 'without' | 'with' | 'only';
	}
) {
	const filters = args.filters ?? {};
	if (filters.createdRange) return null;

	const targetKind = resolvedTargetKind(filters, args.lens);
	if (targetKind) {
		return null;
	}

	if (args.trashed === 'only') {
		return ctx.db
			.query('adminDemoComments')
			.withIndex('by_deleted', (q: any) => q.gt('deletedAt', 0));
	}
	if (args.trashed === 'without') {
		return ctx.db
			.query('adminDemoComments')
			.withIndex('by_deleted', (q: any) => q.eq('deletedAt', undefined));
	}
	return ctx.db.query('adminDemoComments');
}

export const listComments = permissionQuery({
	args: listArgsValidator,
	handler: async (ctx, args) => {
		assertPermission(ctx.user, { resource: ['read'] });
		const search = args.search?.trim();
		const indexedQuery = getIndexedCommentQuery(ctx, {
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
			const hydrated = await hydrateCommentRows(paginated.items as AdminDemoComment[], ctx);
			return {
				items: applyFieldVisibilityList({
					items: hydrated,
					user: ctx.user,
					policies: commentFieldPolicies
				}),
				continueCursor: paginated.continueCursor,
				isDone: paginated.isDone
			};
		}

		const canUseSearchIndex =
			Boolean(search) &&
			!args.sortBy &&
			!(args.filters?.createdRange ?? '') &&
			(!args.filters?.targetKind || args.filters.targetKind === 'all') &&
			!args.lens &&
			(args.trashed ?? 'without') === 'without';
		if (canUseSearchIndex) {
			const paginated = await runPaginatedListQuery({
				query: ctx.db
					.query('adminDemoComments')
					.withSearchIndex(commentSearchIndex.indexName, (q: any) =>
						q.search(commentSearchIndex.searchField, search as string).eq('deletedAt', undefined)
					),
				cursor: args.cursor,
				numItems: args.numItems
			});
			const hydrated = await hydrateCommentRows(paginated.items as AdminDemoComment[], ctx);
			return {
				items: applyFieldVisibilityList({
					items: hydrated,
					user: ctx.user,
					policies: commentFieldPolicies
				}),
				continueCursor: paginated.continueCursor,
				isDone: paginated.isDone
			};
		}

		const comments = await ctx.db.query('adminDemoComments').collect();
		const result = runResourceListQuery({
			items: comments,
			cursor: args.cursor,
			numItems: args.numItems,
			search,
			trashed: args.trashed,
			sortBy: args.sortBy,
			sortMap: {
				createdAt: (item) => item.createdAt,
				updatedAt: (item) => item.updatedAt,
				authorEmail: (item) => item.authorEmail
			},
			searchableValues: (item) => [item.text, item.authorEmail],
			applyFilters: (item) => matchesCommentFilters(item, args.filters ?? {}),
			applyLens: (item) => matchesCommentLens(item, args.lens)
		});
		const hydrated = await hydrateCommentRows(result.items, ctx);

		return {
			items: applyFieldVisibilityList({
				items: hydrated,
				user: ctx.user,
				policies: commentFieldPolicies
			}),
			continueCursor: result.continueCursor,
			isDone: result.isDone
		};
	}
});

export const countComments = permissionQuery({
	args: countArgsValidator,
	handler: async (ctx, args) => {
		assertPermission(ctx.user, { resource: ['read'] });
		const search = args.search?.trim();
		const indexedQuery = getIndexedCommentQuery(ctx, {
			filters: args.filters,
			lens: args.lens,
			trashed: args.trashed
		});
		if (!search && indexedQuery) {
			return countPaginatedQuery({
				createQuery: () =>
					getIndexedCommentQuery(ctx, {
						filters: args.filters,
						lens: args.lens,
						trashed: args.trashed
					}) as any
			});
		}

		const canUseSearchIndex =
			Boolean(search) &&
			!(args.filters?.createdRange ?? '') &&
			(!args.filters?.targetKind || args.filters.targetKind === 'all') &&
			!args.lens &&
			(args.trashed ?? 'without') === 'without';
		if (canUseSearchIndex) {
			return countPaginatedQuery({
				createQuery: () =>
					ctx.db
						.query('adminDemoComments')
						.withSearchIndex(commentSearchIndex.indexName, (q: any) =>
							q.search(commentSearchIndex.searchField, search as string).eq('deletedAt', undefined)
						)
			});
		}

		const comments = await ctx.db.query('adminDemoComments').collect();
		return runResourceListQuery({
			items: comments,
			numItems: comments.length || 1,
			search,
			trashed: args.trashed,
			searchableValues: (item) => [item.text, item.authorEmail],
			applyFilters: (item) => matchesCommentFilters(item, args.filters ?? {}),
			applyLens: (item) => matchesCommentLens(item, args.lens)
		}).totalCount;
	}
});

export const resolveCommentsLastPage = permissionQuery({
	args: resolveLastPageArgsValidator,
	handler: async (ctx, args) => {
		assertPermission(ctx.user, { resource: ['read'] });
		const search = args.search?.trim();
		const indexedQuery = getIndexedCommentQuery(ctx, {
			filters: args.filters,
			lens: args.lens,
			trashed: args.trashed
		});
		if (!search && indexedQuery && !args.sortBy) {
			return resolveLastPageForPaginatedQuery({
				createQuery: () =>
					getIndexedCommentQuery(ctx, {
						filters: args.filters,
						lens: args.lens,
						trashed: args.trashed
					}) as any,
				numItems: args.numItems
			});
		}

		const canUseSearchIndex =
			Boolean(search) &&
			!args.sortBy &&
			!(args.filters?.createdRange ?? '') &&
			(!args.filters?.targetKind || args.filters.targetKind === 'all') &&
			!args.lens &&
			(args.trashed ?? 'without') === 'without';
		if (canUseSearchIndex) {
			return resolveLastPageForPaginatedQuery({
				createQuery: () =>
					ctx.db
						.query('adminDemoComments')
						.withSearchIndex(commentSearchIndex.indexName, (q: any) =>
							q.search(commentSearchIndex.searchField, search as string).eq('deletedAt', undefined)
						),
				numItems: args.numItems
			});
		}

		const comments = await ctx.db.query('adminDemoComments').collect();
		const totalCount = runResourceListQuery({
			items: comments,
			numItems: comments.length || 1,
			search,
			trashed: args.trashed,
			searchableValues: (item) => [item.text, item.authorEmail],
			applyFilters: (item) => matchesCommentFilters(item, args.filters ?? {}),
			applyLens: (item) => matchesCommentLens(item, args.lens)
		}).totalCount;
		return resolveLastPage({ totalCount, numItems: args.numItems });
	}
});

export const getCommentById = permissionQuery({
	args: { id: v.id('adminDemoComments') },
	handler: async (ctx, args) => {
		assertPermission(ctx.user, { resource: ['read'] });
		const comment = await ctx.db.get(args.id);
		if (!comment) notFoundError('Comment');
		const target = await resolveCommentTarget(ctx, comment);
		return applyFieldVisibility({
			item: {
				...comment,
				targetKind: target.kind,
				targetTitle: target.title
			} as CommentListItem,
			user: ctx.user,
			policies: commentFieldPolicies
		});
	}
});

const commentValuesValidator = v.object({
	text: v.string(),
	authorEmail: v.string(),
	target: v.union(
		v.object({ kind: v.literal('project'), id: v.id('adminDemoProjects') }),
		v.object({ kind: v.literal('task'), id: v.id('adminDemoTasks') })
	)
});

function validateCommentValues(values: { text: string; authorEmail: string }) {
	const fieldErrors: Record<string, string> = {};
	if (values.text.trim().length === 0) {
		fieldErrors.text = 'admin.resources.form.required';
	}
	if (values.authorEmail.trim().length === 0) {
		fieldErrors.authorEmail = 'admin.resources.form.required';
	} else if (!values.authorEmail.includes('@')) {
		fieldErrors.authorEmail = 'admin.resources.form.invalid';
	}
	if (Object.keys(fieldErrors).length > 0) {
		validationError(fieldErrors);
	}
}

export const createComment = permissionMutation({
	args: commentValuesValidator,
	handler: async (ctx, args) => {
		assertPermission(ctx.user, { resource: ['create'] });
		assertResourceCrudAllowed({
			resourceName: 'demo-comments',
			operation: 'create',
			user: ctx.user
		});
		validateCommentValues(args);
		const now = Date.now();
		const id = await ctx.db.insert('adminDemoComments', {
			text: args.text,
			authorEmail: args.authorEmail,
			target: args.target,
			...targetIndexFields(args.target),
			createdAt: now,
			updatedAt: now
		});
		return { id };
	}
});

export const updateComment = permissionMutation({
	args: { id: v.id('adminDemoComments'), values: commentValuesValidator },
	handler: async (ctx, args) => {
		assertPermission(ctx.user, { resource: ['update'] });
		validateCommentValues(args.values);
		const comment = await ctx.db.get(args.id);
		if (!comment) notFoundError('Comment');
		assertResourceCrudAllowed({
			resourceName: 'demo-comments',
			operation: 'update',
			user: ctx.user,
			record: comment as Record<string, unknown>
		});
		await ctx.db.patch(args.id, {
			text: args.values.text,
			authorEmail: args.values.authorEmail,
			target: args.values.target,
			...targetIndexFields(args.values.target),
			updatedAt: Date.now()
		});
		return { id: args.id };
	}
});

export const deleteComment = permissionMutation({
	args: { id: v.id('adminDemoComments') },
	handler: async (ctx, args) => {
		assertPermission(ctx.user, { resource: ['delete'] });
		const comment = await ctx.db.get(args.id);
		if (!comment) notFoundError('Comment');
		assertResourceCrudAllowed({
			resourceName: 'demo-comments',
			operation: 'delete',
			user: ctx.user,
			record: comment as Record<string, unknown>
		});
		await ctx.db.patch(args.id, { deletedAt: Date.now(), updatedAt: Date.now() });
		return { id: args.id };
	}
});

export const restoreComment = permissionMutation({
	args: { id: v.id('adminDemoComments') },
	handler: async (ctx, args) => {
		assertPermission(ctx.user, { resource: ['restore'] });
		const comment = await ctx.db.get(args.id);
		if (!comment) notFoundError('Comment');
		assertResourceCrudAllowed({
			resourceName: 'demo-comments',
			operation: 'delete',
			user: ctx.user,
			record: comment as Record<string, unknown>
		});
		await ctx.db.patch(args.id, { deletedAt: undefined, updatedAt: Date.now() });
		return { id: args.id };
	}
});

export const forceDeleteComment = permissionMutation({
	args: { id: v.id('adminDemoComments') },
	handler: async (ctx, args) => {
		assertPermission(ctx.user, { resource: ['force-delete'] });
		const comment = await ctx.db.get(args.id);
		if (!comment) notFoundError('Comment');
		assertResourceCrudAllowed({
			resourceName: 'demo-comments',
			operation: 'delete',
			user: ctx.user,
			record: comment as Record<string, unknown>
		});
		await ctx.db.delete(args.id);
		return { id: args.id };
	}
});

export const replicateComment = permissionMutation({
	args: { id: v.id('adminDemoComments') },
	handler: async (ctx, args) => {
		assertPermission(ctx.user, { resource: ['replicate'] });
		const comment = await ctx.db.get(args.id);
		if (!comment) notFoundError('Comment');
		assertResourceCrudAllowed({
			resourceName: 'demo-comments',
			operation: 'update',
			user: ctx.user,
			record: comment as Record<string, unknown>
		});
		const now = Date.now();
		const id = await ctx.db.insert('adminDemoComments', {
			text: `${comment.text} (Copy)`,
			authorEmail: comment.authorEmail,
			target: comment.target,
			...targetIndexFields(comment.target),
			createdAt: now,
			updatedAt: now
		});
		return { id };
	}
});

export const runCommentAction = permissionMutation({
	args: {
		action: v.union(v.literal('markReviewed')),
		ids: v.array(v.id('adminDemoComments'))
	},
	handler: async (_ctx, _args): Promise<ActionResponse> => {
		return success('admin.resources.toasts.action_success');
	}
});

export const getCommentMetrics = permissionQuery({
	args: {
		ranges: v.optional(v.record(v.string(), v.string()))
	},
	handler: async (ctx) => {
		assertPermission(ctx.user, { metric: ['read'] });
		const [total, project, task] = await Promise.all([
			aggregateCountLiveComments(ctx),
			aggregateCountCommentsByTarget(ctx, 'project'),
			aggregateCountCommentsByTarget(ctx, 'task')
		]);
		return {
			cards: [
				{ key: 'total', type: 'value', value: total },
				{
					key: 'targetDistribution',
					type: 'partition',
					segments: [
						{ labelKey: 'admin.resources.comments.options.project', value: project },
						{ labelKey: 'admin.resources.comments.options.task', value: task }
					]
				}
			]
		};
	}
});

export const listCommentsForProject = permissionQuery({
	args: { projectId: v.id('adminDemoProjects') },
	handler: async (ctx, args) => {
		assertPermission(ctx.user, { resource: ['read'] });
		return ctx.db
			.query('adminDemoComments')
			.withIndex('by_target_project', (q) => q.eq('targetProjectId', args.projectId))
			.collect();
	}
});

export const listCommentsForTask = permissionQuery({
	args: { taskId: v.id('adminDemoTasks') },
	handler: async (ctx, args) => {
		assertPermission(ctx.user, { resource: ['read'] });
		return ctx.db
			.query('adminDemoComments')
			.withIndex('by_target_task', (q) => q.eq('targetTaskId', args.taskId))
			.collect();
	}
});
