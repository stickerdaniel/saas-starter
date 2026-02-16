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
import { assertResourceCrudAllowed } from '../utils/resource_guards';
import {
	aggregateCountLiveTasks,
	aggregateCountTasksByPriority,
	aggregateCountTasksByStatus,
	aggregateSumTaskEstimate,
	aggregateSumTaskEstimateByStatus
} from '../utils/aggregates';
import { getResourceSearchIndexConfig } from '../utils/search_index';

export type AdminDemoTask = Doc<'adminDemoTasks'>;

type TaskListItem = AdminDemoTask & {
	projectName: string;
};

const taskFieldPolicies: FieldPolicy<TaskListItem>[] = [
	{ attribute: 'title' },
	{ attribute: 'projectId' },
	{ attribute: 'projectName' },
	{ attribute: 'status' },
	{ attribute: 'priority' },
	{ attribute: 'estimateHours' },
	{
		attribute: 'assigneeEmail',
		canSee: (_user, item) => item.priority === 'high'
	},
	{ attribute: 'createdAt' },
	{ attribute: 'updatedAt' }
];

const taskSearchIndex = getResourceSearchIndexConfig('demo-tasks');

function matchesTaskFilters(task: AdminDemoTask, filters: Record<string, string>) {
	if (filters.projectId && task.projectId !== filters.projectId) {
		return false;
	}
	if (filters.status && filters.status !== 'all' && task.status !== filters.status) {
		return false;
	}
	if (filters.priority && filters.priority !== 'all' && task.priority !== filters.priority) {
		return false;
	}
	const createdRange = filters.createdRange;
	if (createdRange && createdRange.includes('..')) {
		const [startDate, endDate] = createdRange.split('..');
		const start = startDate ? new Date(startDate).getTime() : Number.NaN;
		const end = endDate ? new Date(endDate).getTime() : Number.NaN;
		if (Number.isFinite(start) && Number.isFinite(end)) {
			const endOfDay = end + 86_399_999;
			if (task.createdAt < start || task.createdAt > endOfDay) {
				return false;
			}
		}
	}
	return true;
}

function matchesTaskLens(task: AdminDemoTask, lens: string | undefined) {
	if (!lens) return true;
	if (lens === 'due') return task.status !== 'done';
	if (lens === 'completed') return task.status === 'done';
	return true;
}

async function hydrateTaskRows(rows: AdminDemoTask[], ctx: any): Promise<TaskListItem[]> {
	return Promise.all(
		rows.map(async (task) => {
			const project = await ctx.db.get(task.projectId);
			return {
				...task,
				projectName: project?.name ?? 'Unknown project'
			};
		})
	);
}

function getIndexedTaskQuery(
	ctx: any,
	args: {
		filters?: Record<string, string>;
		lens?: string;
		trashed?: 'without' | 'with' | 'only';
	}
) {
	const filters = args.filters ?? {};
	const hasSearchOnlyFilters = Boolean(filters.createdRange);
	if (hasSearchOnlyFilters) return null;

	const priorityFilter = filters.priority;
	if (priorityFilter && priorityFilter !== 'all') return null;

	const projectFilter = filters.projectId;
	if (projectFilter) {
		return ctx.db
			.query('adminDemoTasks')
			.withIndex('by_project', (q: any) => q.eq('projectId', projectFilter));
	}

	const statusFilter = filters.status;
	let statusValue: string | undefined = undefined;
	if (statusFilter && statusFilter !== 'all') {
		statusValue = statusFilter;
	}
	if (args.lens === 'completed') {
		statusValue = 'done';
	}
	if (args.lens === 'due') {
		return null;
	}

	if (statusValue) {
		return ctx.db
			.query('adminDemoTasks')
			.withIndex('by_status', (q: any) => q.eq('status', statusValue));
	}

	if (args.trashed === 'only') {
		return ctx.db.query('adminDemoTasks').withIndex('by_deleted', (q: any) => q.gt('deletedAt', 0));
	}
	if (args.trashed === 'without') {
		return ctx.db
			.query('adminDemoTasks')
			.withIndex('by_deleted', (q: any) => q.eq('deletedAt', undefined));
	}

	return ctx.db.query('adminDemoTasks');
}

export const listTasks = permissionQuery({
	args: listArgsValidator,
	handler: async (ctx, args) => {
		assertPermission(ctx.user, { resource: ['read'] });
		const search = args.search?.trim();
		const indexedQuery = getIndexedTaskQuery(ctx, {
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
			const hydrated = await hydrateTaskRows(paginated.items as AdminDemoTask[], ctx);
			return {
				items: applyFieldVisibilityList({
					items: hydrated,
					user: ctx.user,
					policies: taskFieldPolicies
				}),
				continueCursor: paginated.continueCursor,
				isDone: paginated.isDone
			};
		}

		const canUseSearchIndex =
			Boolean(search) &&
			!args.sortBy &&
			!(args.filters?.createdRange ?? '') &&
			!(args.filters?.projectId ?? '') &&
			(!args.filters?.status || args.filters.status === 'all') &&
			(!args.filters?.priority || args.filters.priority === 'all') &&
			!args.lens &&
			(args.trashed ?? 'without') === 'without';

		if (canUseSearchIndex) {
			const paginated = await runPaginatedListQuery({
				query: ctx.db
					.query('adminDemoTasks')
					.withSearchIndex(taskSearchIndex.indexName, (q: any) =>
						q.search(taskSearchIndex.searchField, search as string).eq('deletedAt', undefined)
					),
				cursor: args.cursor,
				numItems: args.numItems
			});
			const hydrated = await hydrateTaskRows(paginated.items as AdminDemoTask[], ctx);
			return {
				items: applyFieldVisibilityList({
					items: hydrated,
					user: ctx.user,
					policies: taskFieldPolicies
				}),
				continueCursor: paginated.continueCursor,
				isDone: paginated.isDone
			};
		}

		const tasks = await ctx.db.query('adminDemoTasks').collect();
		const result = runResourceListQuery({
			items: tasks,
			cursor: args.cursor,
			numItems: args.numItems,
			search,
			trashed: args.trashed,
			sortBy: args.sortBy,
			sortMap: {
				title: (item) => item.title,
				status: (item) => item.status,
				priority: (item) => item.priority,
				estimateHours: (item) => item.estimateHours,
				createdAt: (item) => item.createdAt,
				updatedAt: (item) => item.updatedAt
			},
			searchableValues: (item) => [item.title, item.assigneeEmail ?? ''],
			applyFilters: (item) => matchesTaskFilters(item, args.filters ?? {}),
			applyLens: (item) => matchesTaskLens(item, args.lens)
		});
		const hydrated = await hydrateTaskRows(result.items, ctx);

		return {
			items: applyFieldVisibilityList({
				items: hydrated,
				user: ctx.user,
				policies: taskFieldPolicies
			}),
			continueCursor: result.continueCursor,
			isDone: result.isDone
		};
	}
});

export const countTasks = permissionQuery({
	args: countArgsValidator,
	handler: async (ctx, args) => {
		assertPermission(ctx.user, { resource: ['read'] });
		const search = args.search?.trim();
		const indexedQuery = getIndexedTaskQuery(ctx, {
			filters: args.filters,
			lens: args.lens,
			trashed: args.trashed
		});
		if (!search && indexedQuery) {
			return countPaginatedQuery({
				createQuery: () =>
					getIndexedTaskQuery(ctx, {
						filters: args.filters,
						lens: args.lens,
						trashed: args.trashed
					}) as any
			});
		}
		const canUseSearchIndex =
			Boolean(search) &&
			!(args.filters?.createdRange ?? '') &&
			!(args.filters?.projectId ?? '') &&
			(!args.filters?.status || args.filters.status === 'all') &&
			(!args.filters?.priority || args.filters.priority === 'all') &&
			!args.lens &&
			(args.trashed ?? 'without') === 'without';
		if (canUseSearchIndex) {
			return countPaginatedQuery({
				createQuery: () =>
					ctx.db
						.query('adminDemoTasks')
						.withSearchIndex(taskSearchIndex.indexName, (q: any) =>
							q.search(taskSearchIndex.searchField, search as string).eq('deletedAt', undefined)
						)
			});
		}

		const tasks = await ctx.db.query('adminDemoTasks').collect();
		return runResourceListQuery({
			items: tasks,
			numItems: tasks.length || 1,
			search,
			trashed: args.trashed,
			searchableValues: (item) => [item.title, item.assigneeEmail ?? ''],
			applyFilters: (item) => matchesTaskFilters(item, args.filters ?? {}),
			applyLens: (item) => matchesTaskLens(item, args.lens)
		}).totalCount;
	}
});

export const resolveTasksLastPage = permissionQuery({
	args: resolveLastPageArgsValidator,
	handler: async (ctx, args) => {
		assertPermission(ctx.user, { resource: ['read'] });
		const search = args.search?.trim();
		const indexedQuery = getIndexedTaskQuery(ctx, {
			filters: args.filters,
			lens: args.lens,
			trashed: args.trashed
		});
		if (!search && indexedQuery && !args.sortBy) {
			return resolveLastPageForPaginatedQuery({
				createQuery: () =>
					getIndexedTaskQuery(ctx, {
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
			!(args.filters?.projectId ?? '') &&
			(!args.filters?.status || args.filters.status === 'all') &&
			(!args.filters?.priority || args.filters.priority === 'all') &&
			!args.lens &&
			(args.trashed ?? 'without') === 'without';
		if (canUseSearchIndex) {
			return resolveLastPageForPaginatedQuery({
				createQuery: () =>
					ctx.db
						.query('adminDemoTasks')
						.withSearchIndex(taskSearchIndex.indexName, (q: any) =>
							q.search(taskSearchIndex.searchField, search as string).eq('deletedAt', undefined)
						),
				numItems: args.numItems
			});
		}

		const tasks = await ctx.db.query('adminDemoTasks').collect();
		const totalCount = runResourceListQuery({
			items: tasks,
			numItems: tasks.length || 1,
			search,
			trashed: args.trashed,
			searchableValues: (item) => [item.title, item.assigneeEmail ?? ''],
			applyFilters: (item) => matchesTaskFilters(item, args.filters ?? {}),
			applyLens: (item) => matchesTaskLens(item, args.lens)
		}).totalCount;
		return resolveLastPage({ totalCount, numItems: args.numItems });
	}
});

export const getTaskById = permissionQuery({
	args: { id: v.id('adminDemoTasks') },
	handler: async (ctx, args) => {
		assertPermission(ctx.user, { resource: ['read'] });
		const task = await ctx.db.get(args.id);
		if (!task) notFoundError('Task');
		const project = await ctx.db.get(task.projectId);
		return applyFieldVisibility({
			item: {
				...task,
				projectName: project?.name ?? 'Unknown project'
			} as TaskListItem,
			user: ctx.user,
			policies: taskFieldPolicies
		});
	}
});

const taskValueValidator = v.object({
	projectId: v.id('adminDemoProjects'),
	title: v.string(),
	status: v.union(v.literal('todo'), v.literal('in_progress'), v.literal('done')),
	priority: v.union(v.literal('low'), v.literal('medium'), v.literal('high')),
	estimateHours: v.number(),
	assigneeEmail: v.optional(v.string())
});

const taskUpdateValueValidator = v.object({
	projectId: v.optional(v.id('adminDemoProjects')),
	title: v.optional(v.string()),
	status: v.optional(v.union(v.literal('todo'), v.literal('in_progress'), v.literal('done'))),
	priority: v.optional(v.union(v.literal('low'), v.literal('medium'), v.literal('high'))),
	estimateHours: v.optional(v.number()),
	assigneeEmail: v.optional(v.string())
});

function validateTaskValues(values: {
	title: string;
	estimateHours: number;
	assigneeEmail?: string;
}) {
	const fieldErrors: Record<string, string> = {};
	if (values.title.trim().length === 0) {
		fieldErrors.title = 'Task title is required.';
	}
	if (!Number.isFinite(values.estimateHours) || values.estimateHours < 0) {
		fieldErrors.estimateHours = 'Estimate hours must be a non-negative number.';
	}
	if (values.assigneeEmail && !values.assigneeEmail.includes('@')) {
		fieldErrors.assigneeEmail = 'Assignee email must be a valid email.';
	}
	if (Object.keys(fieldErrors).length > 0) {
		validationError(fieldErrors);
	}
}

export const createTask = permissionMutation({
	args: taskValueValidator,
	handler: async (ctx, args) => {
		assertPermission(ctx.user, { resource: ['create'] });
		assertResourceCrudAllowed({
			resourceName: 'demo-tasks',
			operation: 'create',
			user: ctx.user
		});
		validateTaskValues(args);
		const now = Date.now();
		const id = await ctx.db.insert('adminDemoTasks', {
			projectId: args.projectId,
			title: args.title,
			status: args.status,
			priority: args.priority,
			estimateHours: args.estimateHours,
			assigneeEmail: args.assigneeEmail,
			createdAt: now,
			updatedAt: now
		});
		return { id };
	}
});

export const updateTask = permissionMutation({
	args: { id: v.id('adminDemoTasks'), values: taskUpdateValueValidator },
	handler: async (ctx, args) => {
		assertPermission(ctx.user, { resource: ['update'] });
		const task = await ctx.db.get(args.id);
		if (!task) notFoundError('Task');
		assertResourceCrudAllowed({
			resourceName: 'demo-tasks',
			operation: 'update',
			user: ctx.user,
			record: task as Record<string, unknown>
		});
		const nextValues = {
			projectId: args.values.projectId ?? task.projectId,
			title: args.values.title ?? task.title,
			status: args.values.status ?? task.status,
			priority: args.values.priority ?? task.priority,
			estimateHours: args.values.estimateHours ?? task.estimateHours,
			assigneeEmail: args.values.assigneeEmail ?? task.assigneeEmail
		};
		validateTaskValues(nextValues);
		await ctx.db.patch(args.id, {
			...nextValues,
			updatedAt: Date.now()
		});
		return { id: args.id };
	}
});

export const deleteTask = permissionMutation({
	args: { id: v.id('adminDemoTasks') },
	handler: async (ctx, args) => {
		assertPermission(ctx.user, { resource: ['delete'] });
		const task = await ctx.db.get(args.id);
		if (!task) notFoundError('Task');
		assertResourceCrudAllowed({
			resourceName: 'demo-tasks',
			operation: 'delete',
			user: ctx.user,
			record: task as Record<string, unknown>
		});
		await ctx.db.patch(args.id, { deletedAt: Date.now(), updatedAt: Date.now() });
		return { id: args.id };
	}
});

export const restoreTask = permissionMutation({
	args: { id: v.id('adminDemoTasks') },
	handler: async (ctx, args) => {
		assertPermission(ctx.user, { resource: ['restore'] });
		const task = await ctx.db.get(args.id);
		if (!task) notFoundError('Task');
		assertResourceCrudAllowed({
			resourceName: 'demo-tasks',
			operation: 'delete',
			user: ctx.user,
			record: task as Record<string, unknown>
		});
		await ctx.db.patch(args.id, { deletedAt: undefined, updatedAt: Date.now() });
		return { id: args.id };
	}
});

export const forceDeleteTask = permissionMutation({
	args: { id: v.id('adminDemoTasks') },
	handler: async (ctx, args) => {
		assertPermission(ctx.user, { resource: ['force-delete'] });
		const task = await ctx.db.get(args.id);
		if (!task) notFoundError('Task');
		assertResourceCrudAllowed({
			resourceName: 'demo-tasks',
			operation: 'delete',
			user: ctx.user,
			record: task as Record<string, unknown>
		});
		await ctx.db.delete(args.id);
		return { id: args.id };
	}
});

export const replicateTask = permissionMutation({
	args: { id: v.id('adminDemoTasks') },
	handler: async (ctx, args) => {
		assertPermission(ctx.user, { resource: ['replicate'] });
		const task = await ctx.db.get(args.id);
		if (!task) notFoundError('Task');
		assertResourceCrudAllowed({
			resourceName: 'demo-tasks',
			operation: 'update',
			user: ctx.user,
			record: task as Record<string, unknown>
		});
		const now = Date.now();
		const id = await ctx.db.insert('adminDemoTasks', {
			projectId: task.projectId,
			title: `${task.title} (Copy)`,
			status: 'todo',
			priority: task.priority,
			estimateHours: task.estimateHours,
			assigneeEmail: task.assigneeEmail,
			createdAt: now,
			updatedAt: now
		});
		return { id };
	}
});

const taskActionValidator = v.union(v.literal('markDone'), v.literal('markInProgress'));

export const runTaskAction = permissionMutation({
	args: {
		action: taskActionValidator,
		ids: v.array(v.id('adminDemoTasks'))
	},
	handler: async (ctx, args): Promise<ActionResponse> => {
		assertPermission(ctx.user, { action: ['run'] });
		if (args.ids.length === 0) return { type: 'danger', text: 'No records selected.' };

		for (const id of args.ids) {
			const task = await ctx.db.get(id);
			if (!task) continue;
			await ctx.db.patch(id, {
				status: args.action === 'markDone' ? 'done' : 'in_progress',
				updatedAt: Date.now()
			});
		}
		return success('Action completed.');
	}
});

export const getTaskMetrics = permissionQuery({
	args: {
		ranges: v.optional(v.record(v.string(), v.string()))
	},
	handler: async (ctx) => {
		assertPermission(ctx.user, { metric: ['read'] });
		const [
			liveCount,
			todo,
			progress,
			done,
			estimateTotal,
			priorityLow,
			priorityMedium,
			priorityHigh,
			estimateTodo,
			estimateInProgress,
			estimateDone
		] = await Promise.all([
			aggregateCountLiveTasks(ctx),
			aggregateCountTasksByStatus(ctx, 'todo'),
			aggregateCountTasksByStatus(ctx, 'in_progress'),
			aggregateCountTasksByStatus(ctx, 'done'),
			aggregateSumTaskEstimate(ctx),
			aggregateCountTasksByPriority(ctx, 'low'),
			aggregateCountTasksByPriority(ctx, 'medium'),
			aggregateCountTasksByPriority(ctx, 'high'),
			aggregateSumTaskEstimateByStatus(ctx, 'todo'),
			aggregateSumTaskEstimateByStatus(ctx, 'in_progress'),
			aggregateSumTaskEstimateByStatus(ctx, 'done')
		]);
		return {
			cards: [
				{ key: 'todo', type: 'value', value: todo },
				{ key: 'inProgress', type: 'value', value: progress },
				{ key: 'done', type: 'value', value: done },
				{ key: 'estimate', type: 'value', value: estimateTotal },
				{
					key: 'completionRate',
					type: 'progress',
					value: done,
					target: Math.max(liveCount, 1)
				},
				{
					key: 'statusTrend',
					type: 'trend',
					points: [
						{ labelKey: 'admin.resources.tasks.options.todo', value: todo },
						{ labelKey: 'admin.resources.tasks.options.in_progress', value: progress },
						{ labelKey: 'admin.resources.tasks.options.done', value: done }
					]
				},
				{
					key: 'prioritySplit',
					type: 'partition',
					segments: [
						{ labelKey: 'admin.resources.tasks.options.low', value: priorityLow },
						{ labelKey: 'admin.resources.tasks.options.medium', value: priorityMedium },
						{ labelKey: 'admin.resources.tasks.options.high', value: priorityHigh }
					]
				},
				{
					key: 'estimateByStatus',
					type: 'table',
					rows: [
						{ labelKey: 'admin.resources.tasks.options.todo', value: estimateTodo },
						{ labelKey: 'admin.resources.tasks.options.in_progress', value: estimateInProgress },
						{ labelKey: 'admin.resources.tasks.options.done', value: estimateDone }
					]
				}
			]
		};
	}
});

export const listTaskOptions = permissionQuery({
	args: {},
	handler: async (ctx) => {
		assertPermission(ctx.user, { resource: ['read'] });
		const tasks = await ctx.db.query('adminDemoTasks').collect();
		return tasks
			.filter((task) => task.deletedAt === undefined)
			.map((task) => ({
				value: task._id,
				label: task.title
			}));
	}
});
