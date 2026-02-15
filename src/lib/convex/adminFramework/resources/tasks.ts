import { v } from 'convex/values';
import type { Doc } from '../../_generated/dataModel';
import { permissionMutation, permissionQuery, assertPermission } from '../access';
import {
	countArgsValidator,
	listArgsValidator,
	resolveLastPage,
	resolveLastPageArgsValidator,
	runResourceListQuery
} from '../utils/resource_query';
import { success, type ActionResponse, notFoundError } from '../utils/errors';

export type AdminDemoTask = Doc<'adminDemoTasks'>;

type TaskListItem = AdminDemoTask & {
	projectName: string;
	_visibleFields: string[];
};

function matchesTaskFilters(task: AdminDemoTask, filters: Record<string, string>) {
	if (filters.status && filters.status !== 'all' && task.status !== filters.status) {
		return false;
	}
	if (filters.priority && filters.priority !== 'all' && task.priority !== filters.priority) {
		return false;
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
				projectName: project?.name ?? 'Unknown project',
				_visibleFields: [
					'title',
					'projectId',
					'projectName',
					'status',
					'priority',
					'estimateHours',
					'assigneeEmail',
					'createdAt',
					'updatedAt'
				]
			};
		})
	);
}

export const listTasks = permissionQuery({
	args: listArgsValidator,
	handler: async (ctx, args) => {
		assertPermission(ctx.user, { resource: ['read'] });
		const tasks = await ctx.db.query('adminDemoTasks').collect();
		const result = runResourceListQuery({
			items: tasks,
			cursor: args.cursor,
			numItems: args.numItems,
			search: args.search,
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

		return {
			items: await hydrateTaskRows(result.items, ctx),
			continueCursor: result.continueCursor,
			isDone: result.isDone
		};
	}
});

export const countTasks = permissionQuery({
	args: countArgsValidator,
	handler: async (ctx, args) => {
		assertPermission(ctx.user, { resource: ['read'] });
		const tasks = await ctx.db.query('adminDemoTasks').collect();
		return runResourceListQuery({
			items: tasks,
			numItems: tasks.length || 1,
			search: args.search,
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
		const tasks = await ctx.db.query('adminDemoTasks').collect();
		const totalCount = runResourceListQuery({
			items: tasks,
			numItems: tasks.length || 1,
			search: args.search,
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
		return {
			...task,
			projectName: project?.name ?? 'Unknown project',
			_visibleFields: [
				'title',
				'projectId',
				'projectName',
				'status',
				'priority',
				'estimateHours',
				'assigneeEmail',
				'createdAt',
				'updatedAt',
				'deletedAt'
			]
		};
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

export const createTask = permissionMutation({
	args: taskValueValidator,
	handler: async (ctx, args) => {
		assertPermission(ctx.user, { resource: ['create'] });
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
	args: { id: v.id('adminDemoTasks'), values: taskValueValidator },
	handler: async (ctx, args) => {
		assertPermission(ctx.user, { resource: ['update'] });
		const task = await ctx.db.get(args.id);
		if (!task) notFoundError('Task');
		await ctx.db.patch(args.id, {
			...args.values,
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
	args: {},
	handler: async (ctx) => {
		assertPermission(ctx.user, { metric: ['read'] });
		const tasks = await ctx.db.query('adminDemoTasks').collect();
		const live = tasks.filter((task) => task.deletedAt === undefined);
		const todo = live.filter((task) => task.status === 'todo').length;
		const progress = live.filter((task) => task.status === 'in_progress').length;
		const done = live.filter((task) => task.status === 'done').length;
		const estimateTotal = live.reduce((sum, task) => sum + task.estimateHours, 0);
		return {
			cards: [
				{ key: 'todo', type: 'value', value: todo },
				{ key: 'inProgress', type: 'value', value: progress },
				{ key: 'done', type: 'value', value: done },
				{ key: 'estimate', type: 'value', value: estimateTotal }
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
