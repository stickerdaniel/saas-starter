import { v } from 'convex/values';
import type { Doc, Id } from '../../_generated/dataModel';
import { permissionMutation, permissionQuery, assertPermission } from '../access';
import {
	countArgsValidator,
	listArgsValidator,
	resolveLastPage,
	resolveLastPageArgsValidator,
	runResourceListQuery
} from '../utils/resource_query';
import { success, type ActionResponse, notFoundError } from '../utils/errors';

export type AdminDemoProject = Doc<'adminDemoProjects'>;

type ProjectListItem = AdminDemoProject & {
	taskCount: number;
	tagCount: number;
	_visibleFields: string[];
};

function matchesProjectFilters(project: AdminDemoProject, filters: Record<string, string>) {
	const status = filters.status;
	if (status && status !== 'all' && project.status !== status) {
		return false;
	}

	const featured = filters.featured;
	if (featured === 'featured' && !project.isFeatured) return false;
	if (featured === 'regular' && project.isFeatured) return false;

	return true;
}

function matchesProjectLens(project: AdminDemoProject, lens: string | undefined) {
	if (!lens) return true;
	if (lens === 'featured') return project.isFeatured;
	if (lens === 'archived') return project.status === 'archived';
	if (lens === 'active') return project.status === 'active';
	return true;
}

async function buildProjectListItems(
	projects: AdminDemoProject[],
	ctx: any
): Promise<ProjectListItem[]> {
	const [tasks, pivots] = await Promise.all([
		ctx.db.query('adminDemoTasks').collect(),
		ctx.db.query('adminDemoProjectTags').collect()
	]);

	const taskCountByProject = new Map<string, number>();
	for (const task of tasks) {
		taskCountByProject.set(task.projectId, (taskCountByProject.get(task.projectId) ?? 0) + 1);
	}

	const tagCountByProject = new Map<string, number>();
	for (const pivot of pivots) {
		tagCountByProject.set(pivot.projectId, (tagCountByProject.get(pivot.projectId) ?? 0) + 1);
	}

	return projects.map((project) => ({
		...project,
		taskCount: taskCountByProject.get(project._id) ?? 0,
		tagCount: tagCountByProject.get(project._id) ?? 0,
		_visibleFields: [
			'name',
			'slug',
			'status',
			'ownerEmail',
			'budget',
			'isFeatured',
			'taskCount',
			'tagCount',
			'createdAt',
			'updatedAt'
		]
	}));
}

export const listProjects = permissionQuery({
	args: listArgsValidator,
	handler: async (ctx, args) => {
		assertPermission(ctx.user, { resource: ['read'] });
		const projects = await ctx.db.query('adminDemoProjects').collect();
		const query = runResourceListQuery({
			items: projects,
			cursor: args.cursor,
			numItems: args.numItems,
			search: args.search,
			trashed: args.trashed,
			sortBy: args.sortBy,
			sortMap: {
				name: (item) => item.name,
				status: (item) => item.status,
				budget: (item) => item.budget,
				createdAt: (item) => item.createdAt,
				updatedAt: (item) => item.updatedAt
			},
			searchableValues: (item) => [item.name, item.slug, item.ownerEmail, item.description ?? ''],
			applyFilters: (item) => matchesProjectFilters(item, args.filters ?? {}),
			applyLens: (item) => matchesProjectLens(item, args.lens)
		});

		return {
			items: await buildProjectListItems(query.items, ctx),
			continueCursor: query.continueCursor,
			isDone: query.isDone
		};
	}
});

export const countProjects = permissionQuery({
	args: countArgsValidator,
	handler: async (ctx, args) => {
		assertPermission(ctx.user, { resource: ['read'] });
		const projects = await ctx.db.query('adminDemoProjects').collect();
		return runResourceListQuery({
			items: projects,
			numItems: projects.length || 1,
			search: args.search,
			trashed: args.trashed,
			searchableValues: (item) => [item.name, item.slug, item.ownerEmail, item.description ?? ''],
			applyFilters: (item) => matchesProjectFilters(item, args.filters ?? {}),
			applyLens: (item) => matchesProjectLens(item, args.lens)
		}).totalCount;
	}
});

export const resolveProjectsLastPage = permissionQuery({
	args: resolveLastPageArgsValidator,
	handler: async (ctx, args) => {
		assertPermission(ctx.user, { resource: ['read'] });
		const projects = await ctx.db.query('adminDemoProjects').collect();
		const totalCount = runResourceListQuery({
			items: projects,
			numItems: projects.length || 1,
			search: args.search,
			trashed: args.trashed,
			searchableValues: (item) => [item.name, item.slug, item.ownerEmail, item.description ?? ''],
			applyFilters: (item) => matchesProjectFilters(item, args.filters ?? {}),
			applyLens: (item) => matchesProjectLens(item, args.lens)
		}).totalCount;
		return resolveLastPage({ totalCount, numItems: args.numItems });
	}
});

export const getProjectById = permissionQuery({
	args: { id: v.id('adminDemoProjects') },
	handler: async (ctx, args) => {
		assertPermission(ctx.user, { resource: ['read'] });
		const project = await ctx.db.get(args.id);
		if (!project) notFoundError('Project');

		const pivots = await ctx.db
			.query('adminDemoProjectTags')
			.withIndex('by_project', (q) => q.eq('projectId', args.id))
			.collect();

		const tags = await Promise.all(pivots.map((pivot) => ctx.db.get(pivot.tagId)));

		const tasks = await ctx.db
			.query('adminDemoTasks')
			.withIndex('by_project', (q) => q.eq('projectId', args.id))
			.collect();

		return {
			...project,
			tags: tags.filter(Boolean),
			taskCount: tasks.length,
			_visibleFields: [
				'name',
				'slug',
				'status',
				'ownerEmail',
				'budget',
				'isFeatured',
				'description',
				'createdAt',
				'updatedAt',
				'deletedAt'
			]
		};
	}
});

const createProjectValuesValidator = v.object({
	name: v.string(),
	slug: v.string(),
	status: v.union(v.literal('draft'), v.literal('active'), v.literal('archived')),
	ownerEmail: v.string(),
	budget: v.number(),
	isFeatured: v.boolean(),
	description: v.optional(v.string()),
	tagIds: v.optional(v.array(v.id('adminDemoTags')))
});

export const createProject = permissionMutation({
	args: createProjectValuesValidator,
	handler: async (ctx, args) => {
		assertPermission(ctx.user, { resource: ['create'] });
		const now = Date.now();
		const projectId = await ctx.db.insert('adminDemoProjects', {
			name: args.name,
			slug: args.slug,
			status: args.status,
			ownerEmail: args.ownerEmail,
			budget: args.budget,
			isFeatured: args.isFeatured,
			description: args.description,
			createdAt: now,
			updatedAt: now
		});

		for (const tagId of args.tagIds ?? []) {
			await ctx.db.insert('adminDemoProjectTags', {
				projectId,
				tagId,
				createdAt: now
			});
		}

		return { id: projectId };
	}
});

export const updateProject = permissionMutation({
	args: {
		id: v.id('adminDemoProjects'),
		values: createProjectValuesValidator
	},
	handler: async (ctx, args) => {
		assertPermission(ctx.user, { resource: ['update'] });
		const project = await ctx.db.get(args.id);
		if (!project) notFoundError('Project');

		await ctx.db.patch(args.id, {
			name: args.values.name,
			slug: args.values.slug,
			status: args.values.status,
			ownerEmail: args.values.ownerEmail,
			budget: args.values.budget,
			isFeatured: args.values.isFeatured,
			description: args.values.description,
			updatedAt: Date.now()
		});

		const existing = await ctx.db
			.query('adminDemoProjectTags')
			.withIndex('by_project', (q) => q.eq('projectId', args.id))
			.collect();
		for (const row of existing) {
			await ctx.db.delete(row._id);
		}

		for (const tagId of args.values.tagIds ?? []) {
			await ctx.db.insert('adminDemoProjectTags', {
				projectId: args.id,
				tagId,
				createdAt: Date.now()
			});
		}

		return { id: args.id };
	}
});

export const deleteProject = permissionMutation({
	args: { id: v.id('adminDemoProjects') },
	handler: async (ctx, args) => {
		assertPermission(ctx.user, { resource: ['delete'] });
		const project = await ctx.db.get(args.id);
		if (!project) notFoundError('Project');
		await ctx.db.patch(args.id, {
			deletedAt: Date.now(),
			updatedAt: Date.now()
		});
		return { id: args.id };
	}
});

export const restoreProject = permissionMutation({
	args: { id: v.id('adminDemoProjects') },
	handler: async (ctx, args) => {
		assertPermission(ctx.user, { resource: ['restore'] });
		const project = await ctx.db.get(args.id);
		if (!project) notFoundError('Project');
		await ctx.db.patch(args.id, {
			deletedAt: undefined,
			updatedAt: Date.now()
		});
		return { id: args.id };
	}
});

export const forceDeleteProject = permissionMutation({
	args: { id: v.id('adminDemoProjects') },
	handler: async (ctx, args) => {
		assertPermission(ctx.user, { resource: ['force-delete'] });
		const project = await ctx.db.get(args.id);
		if (!project) notFoundError('Project');

		const relatedTasks = await ctx.db
			.query('adminDemoTasks')
			.withIndex('by_project', (q) => q.eq('projectId', args.id))
			.collect();
		for (const task of relatedTasks) {
			await ctx.db.delete(task._id);
		}

		const pivots = await ctx.db
			.query('adminDemoProjectTags')
			.withIndex('by_project', (q) => q.eq('projectId', args.id))
			.collect();
		for (const pivot of pivots) {
			await ctx.db.delete(pivot._id);
		}

		await ctx.db.delete(args.id);
		return { id: args.id };
	}
});

export const replicateProject = permissionMutation({
	args: { id: v.id('adminDemoProjects') },
	handler: async (ctx, args) => {
		assertPermission(ctx.user, { resource: ['replicate'] });
		const project = await ctx.db.get(args.id);
		if (!project) notFoundError('Project');

		const now = Date.now();
		const duplicated = await ctx.db.insert('adminDemoProjects', {
			name: `${project.name} (Copy)`,
			slug: `${project.slug}-copy-${now}`,
			status: 'draft',
			ownerEmail: project.ownerEmail,
			budget: project.budget,
			isFeatured: false,
			description: project.description,
			createdAt: now,
			updatedAt: now
		});

		return { id: duplicated };
	}
});

const projectActionValidator = v.union(
	v.literal('feature'),
	v.literal('unfeature'),
	v.literal('archive'),
	v.literal('attachTag'),
	v.literal('detachTag')
);

export const runProjectAction = permissionMutation({
	args: {
		action: projectActionValidator,
		ids: v.array(v.id('adminDemoProjects')),
		values: v.optional(v.object({ tagId: v.optional(v.id('adminDemoTags')) }))
	},
	handler: async (ctx, args): Promise<ActionResponse> => {
		assertPermission(ctx.user, { action: ['run'] });
		if (args.ids.length === 0) {
			return { type: 'danger', text: 'No records selected.' };
		}

		if (args.action === 'attachTag') {
			if (!args.values?.tagId) {
				return { type: 'danger', text: 'Tag is required.' };
			}
			for (const id of args.ids) {
				const exists = await ctx.db
					.query('adminDemoProjectTags')
					.withIndex('by_project_and_tag', (q) =>
						q.eq('projectId', id).eq('tagId', args.values!.tagId!)
					)
					.first();
				if (!exists) {
					await ctx.db.insert('adminDemoProjectTags', {
						projectId: id,
						tagId: args.values.tagId,
						createdAt: Date.now()
					});
				}
			}
			return success('Tag attached.');
		}

		if (args.action === 'detachTag') {
			if (!args.values?.tagId) {
				return { type: 'danger', text: 'Tag is required.' };
			}
			for (const id of args.ids) {
				const rows = await ctx.db
					.query('adminDemoProjectTags')
					.withIndex('by_project_and_tag', (q) =>
						q.eq('projectId', id).eq('tagId', args.values!.tagId!)
					)
					.collect();
				for (const row of rows) {
					await ctx.db.delete(row._id);
				}
			}
			return success('Tag detached.');
		}

		for (const id of args.ids) {
			const project = await ctx.db.get(id);
			if (!project) continue;
			if (args.action === 'feature') {
				await ctx.db.patch(id, { isFeatured: true, updatedAt: Date.now() });
			} else if (args.action === 'unfeature') {
				await ctx.db.patch(id, { isFeatured: false, updatedAt: Date.now() });
			} else if (args.action === 'archive') {
				await ctx.db.patch(id, { status: 'archived', updatedAt: Date.now() });
			}
		}

		return success('Action completed.');
	}
});

export const listProjectTagOptions = permissionQuery({
	args: {},
	handler: async (ctx) => {
		assertPermission(ctx.user, { resource: ['read'] });
		const tags = await ctx.db.query('adminDemoTags').withIndex('by_name').collect();
		return tags.map((tag) => ({
			value: tag._id,
			label: tag.name,
			color: tag.color
		}));
	}
});

export const listProjectOptions = permissionQuery({
	args: {},
	handler: async (ctx) => {
		assertPermission(ctx.user, { resource: ['read'] });
		const projects = await ctx.db.query('adminDemoProjects').collect();
		return projects
			.filter((project) => project.deletedAt === undefined)
			.map((project) => ({
				value: project._id,
				label: project.name
			}));
	}
});

export const attachProjectTag = permissionMutation({
	args: {
		projectId: v.id('adminDemoProjects'),
		tagId: v.id('adminDemoTags')
	},
	handler: async (ctx, args) => {
		assertPermission(ctx.user, { relationship: ['attach'] });
		const exists = await ctx.db
			.query('adminDemoProjectTags')
			.withIndex('by_project_and_tag', (q) =>
				q.eq('projectId', args.projectId).eq('tagId', args.tagId)
			)
			.first();
		if (exists) {
			return { attached: false };
		}

		await ctx.db.insert('adminDemoProjectTags', {
			projectId: args.projectId,
			tagId: args.tagId,
			createdAt: Date.now()
		});
		return { attached: true };
	}
});

export const detachProjectTag = permissionMutation({
	args: {
		projectId: v.id('adminDemoProjects'),
		tagId: v.id('adminDemoTags')
	},
	handler: async (ctx, args) => {
		assertPermission(ctx.user, { relationship: ['detach'] });
		const rows = await ctx.db
			.query('adminDemoProjectTags')
			.withIndex('by_project_and_tag', (q) =>
				q.eq('projectId', args.projectId).eq('tagId', args.tagId)
			)
			.collect();
		for (const row of rows) {
			await ctx.db.delete(row._id);
		}
		return { detached: rows.length > 0 };
	}
});

export const getProjectMetrics = permissionQuery({
	args: {},
	handler: async (ctx) => {
		assertPermission(ctx.user, { metric: ['read'] });
		const projects = await ctx.db.query('adminDemoProjects').collect();
		const active = projects.filter(
			(project) => project.deletedAt === undefined && project.status === 'active'
		);
		const archived = projects.filter(
			(project) => project.deletedAt === undefined && project.status === 'archived'
		);
		const featured = projects.filter(
			(project) => project.deletedAt === undefined && project.isFeatured
		);

		const budgetTotal = active.reduce((sum, project) => sum + project.budget, 0);

		return {
			cards: [
				{ key: 'total', type: 'value', value: active.length + archived.length },
				{ key: 'active', type: 'value', value: active.length },
				{ key: 'featured', type: 'value', value: featured.length },
				{ key: 'budget', type: 'value', value: budgetTotal }
			]
		};
	}
});

export const seedProjectDemoData = permissionMutation({
	args: {},
	handler: async (ctx) => {
		assertPermission(ctx.user, { resource: ['create'] });
		const existing = await ctx.db.query('adminDemoProjects').take(1);
		if (existing.length > 0) {
			return { seeded: false };
		}

		const now = Date.now();
		const tagIds: Id<'adminDemoTags'>[] = [];
		for (const [name, color] of [
			['Urgent', '#ef4444'],
			['Growth', '#22c55e'],
			['Platform', '#3b82f6']
		] as const) {
			const tagId = await ctx.db.insert('adminDemoTags', {
				name,
				color,
				createdAt: now,
				updatedAt: now
			});
			tagIds.push(tagId);
		}

		for (const [index, status] of (['draft', 'active', 'active', 'archived'] as const).entries()) {
			const projectId = await ctx.db.insert('adminDemoProjects', {
				name: `Demo Project ${index + 1}`,
				slug: `demo-project-${index + 1}`,
				status,
				ownerEmail: `owner${index + 1}@example.com`,
				budget: 5000 + index * 1200,
				isFeatured: index % 2 === 0,
				description: `Project ${index + 1} generated by admin framework seed data.`,
				createdAt: now - index * 86_400_000,
				updatedAt: now - index * 86_400_000
			});

			for (const tagId of tagIds.slice(0, 2)) {
				await ctx.db.insert('adminDemoProjectTags', {
					projectId,
					tagId,
					createdAt: now
				});
			}
		}

		return { seeded: true };
	}
});
