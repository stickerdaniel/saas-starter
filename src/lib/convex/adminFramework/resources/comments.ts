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

export type AdminDemoComment = Doc<'adminDemoComments'>;

type CommentListItem = AdminDemoComment & {
	targetTitle: string;
	targetKind: 'project' | 'task';
	_visibleFields: string[];
};

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
	return true;
}

function targetIndexFields(target: AdminDemoComment['target']) {
	if (target.kind === 'project') {
		return {
			targetProjectId: target.id,
			targetTaskId: undefined
		};
	}
	return {
		targetProjectId: undefined,
		targetTaskId: target.id
	};
}

async function hydrateCommentRows(rows: AdminDemoComment[], ctx: any): Promise<CommentListItem[]> {
	return Promise.all(
		rows.map(async (comment) => {
			const target = await resolveCommentTarget(ctx, comment);
			return {
				...comment,
				targetKind: target.kind,
				targetTitle: target.title,
				_visibleFields: [
					'text',
					'authorEmail',
					'target',
					'targetKind',
					'targetTitle',
					'createdAt',
					'updatedAt'
				]
			};
		})
	);
}

export const listComments = permissionQuery({
	args: listArgsValidator,
	handler: async (ctx, args) => {
		assertPermission(ctx.user, { resource: ['read'] });
		const comments = await ctx.db.query('adminDemoComments').collect();
		const result = runResourceListQuery({
			items: comments,
			cursor: args.cursor,
			numItems: args.numItems,
			search: args.search,
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

		return {
			items: await hydrateCommentRows(result.items, ctx),
			continueCursor: result.continueCursor,
			isDone: result.isDone
		};
	}
});

export const countComments = permissionQuery({
	args: countArgsValidator,
	handler: async (ctx, args) => {
		assertPermission(ctx.user, { resource: ['read'] });
		const comments = await ctx.db.query('adminDemoComments').collect();
		return runResourceListQuery({
			items: comments,
			numItems: comments.length || 1,
			search: args.search,
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
		const comments = await ctx.db.query('adminDemoComments').collect();
		const totalCount = runResourceListQuery({
			items: comments,
			numItems: comments.length || 1,
			search: args.search,
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
		return {
			...comment,
			targetKind: target.kind,
			targetTitle: target.title,
			_visibleFields: [
				'text',
				'authorEmail',
				'target',
				'targetKind',
				'targetTitle',
				'createdAt',
				'updatedAt',
				'deletedAt'
			]
		};
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

export const createComment = permissionMutation({
	args: commentValuesValidator,
	handler: async (ctx, args) => {
		assertPermission(ctx.user, { resource: ['create'] });
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
		const comment = await ctx.db.get(args.id);
		if (!comment) notFoundError('Comment');
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
		return success('Comments reviewed.');
	}
});

export const getCommentMetrics = permissionQuery({
	args: {},
	handler: async (ctx) => {
		assertPermission(ctx.user, { metric: ['read'] });
		const comments = await ctx.db.query('adminDemoComments').collect();
		const live = comments.filter((comment) => comment.deletedAt === undefined);
		const project = live.filter((comment) => comment.target.kind === 'project').length;
		const task = live.filter((comment) => comment.target.kind === 'task').length;
		return {
			cards: [
				{ key: 'total', type: 'value', value: live.length },
				{ key: 'project', type: 'partition', value: project },
				{ key: 'task', type: 'partition', value: task }
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
