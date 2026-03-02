import { v } from 'convex/values';
import type { Doc, Id } from '../../_generated/dataModel';
import { permissionMutation, permissionQuery, assertPermission } from '../access';
import {
	countArgsValidator,
	listArgsValidator,
	resolveLastPage,
	resolveLastPageArgsValidator,
	countPaginatedQuery,
	resolveLastPageForPaginatedQuery,
	runPaginatedListQuery,
	runResourceListQuery,
	matchesNumberRange
} from '../utils/resource_query';
import { success, type ActionResponse, notFoundError, validationError } from '../utils/errors';
import {
	applyFieldVisibility,
	applyFieldVisibilityList,
	type FieldPolicy
} from '../utils/visibility';
import { assertResourceCrudAllowed, assertRelationAllowed } from '../utils/resource_guards';
import {
	aggregateCountFeaturedProjects,
	aggregateCountProjectsByStatus,
	aggregateSumActiveProjectBudget
} from '../utils/aggregates';
import { getResourceSearchIndexConfig } from '../utils/search_index';

export type AdminDemoProject = Doc<'adminDemoProjects'>;

type ProjectListItem = AdminDemoProject & {
	taskCount: number;
	tagCount: number;
};

const projectFieldPolicies: FieldPolicy<ProjectListItem>[] = [
	{ attribute: 'name' },
	{ attribute: 'slug' },
	{ attribute: 'status' },
	{ attribute: 'ownerEmail' },
	{ attribute: 'budget' },
	{ attribute: 'isFeatured' },
	{ attribute: 'description' },
	{ attribute: 'coverImageUrl' },
	{ attribute: 'specSheetUrl' },
	{ attribute: 'settingsJson' },
	{
		attribute: 'codeSnippet',
		canSee: (_user, item) => item.isFeatured === true
	},
	{ attribute: 'taskCount' },
	{ attribute: 'tagCount' },
	{ attribute: 'tags' },
	{ attribute: 'createdAt' },
	{ attribute: 'updatedAt' }
];

const projectSearchIndex = getResourceSearchIndexConfig('demo-projects');

function matchesProjectFilters(project: AdminDemoProject, filters: Record<string, string>) {
	const status = filters.status;
	if (status && status !== 'all' && project.status !== status) {
		return false;
	}

	const featured = filters.featured;
	if (featured === 'featured' && !project.isFeatured) return false;
	if (featured === 'regular' && project.isFeatured) return false;

	const createdRange = filters.createdRange;
	if (createdRange && createdRange.includes('..')) {
		const [startDate, endDate] = createdRange.split('..');
		const start = startDate ? new Date(startDate).getTime() : Number.NaN;
		const end = endDate ? new Date(endDate).getTime() : Number.NaN;
		if (Number.isFinite(start) && Number.isFinite(end)) {
			const endOfDay = end + 86_399_999;
			if (project.createdAt < start || project.createdAt > endOfDay) {
				return false;
			}
		}
	}

	if (!matchesNumberRange(project.budget, filters.budget)) {
		return false;
	}

	return true;
}

function matchesProjectLens(project: AdminDemoProject, lens: string | undefined) {
	if (!lens) return true;
	if (lens === 'featured') return project.isFeatured;
	if (lens === 'archived') return project.status === 'archived';
	if (lens === 'active') return project.status === 'active';
	return true;
}

function resolveProjectStatus(filters: Record<string, string>, lens?: string) {
	const status = filters.status;
	if (status && status !== 'all') return status;
	if (lens === 'active') return 'active';
	if (lens === 'archived') return 'archived';
	return undefined;
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
		tagCount: tagCountByProject.get(project._id) ?? 0
	}));
}

function getIndexedProjectQuery(
	ctx: any,
	args: {
		filters?: Record<string, string>;
		lens?: string;
		trashed?: 'without' | 'with' | 'only';
	}
) {
	const filters = args.filters ?? {};
	if (filters.createdRange) return null;
	if (filters.budget) return null;
	if (filters.featured && filters.featured !== 'all') return null;
	if (args.lens === 'featured') return null;

	const status = resolveProjectStatus(filters, args.lens);
	if (status && (args.trashed ?? 'without') !== 'with') return null;
	if (status) {
		return ctx.db
			.query('adminDemoProjects')
			.withIndex('by_status', (q: any) => q.eq('status', status));
	}

	if (args.trashed === 'only') {
		return ctx.db
			.query('adminDemoProjects')
			.withIndex('by_deleted', (q: any) => q.gt('deletedAt', 0));
	}
	if (args.trashed === 'without') {
		return ctx.db
			.query('adminDemoProjects')
			.withIndex('by_deleted', (q: any) => q.eq('deletedAt', undefined));
	}
	return ctx.db.query('adminDemoProjects');
}

export const listProjects = permissionQuery({
	args: listArgsValidator,
	handler: async (ctx, args) => {
		assertPermission(ctx.user, { resource: ['read'] });
		const search = args.search?.trim();
		const indexedQuery = getIndexedProjectQuery(ctx, {
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
			const hydrated = await buildProjectListItems(paginated.items as AdminDemoProject[], ctx);
			return {
				items: applyFieldVisibilityList({
					items: hydrated,
					user: ctx.user,
					policies: projectFieldPolicies
				}),
				continueCursor: paginated.continueCursor,
				isDone: paginated.isDone
			};
		}

		const status = resolveProjectStatus(args.filters ?? {}, args.lens);
		const canUseSearchIndex =
			Boolean(search) &&
			!args.sortBy &&
			!(args.filters?.createdRange ?? '') &&
			!(args.filters?.budget ?? '') &&
			(!args.filters?.featured || args.filters.featured === 'all') &&
			args.lens !== 'featured' &&
			((args.trashed ?? 'without') === 'without' || (args.trashed ?? 'without') === 'with');
		if (canUseSearchIndex) {
			const paginated = await runPaginatedListQuery({
				query: ctx.db
					.query('adminDemoProjects')
					.withSearchIndex(projectSearchIndex.indexName, (q: any) => {
						let query = q.search(projectSearchIndex.searchField, search as string);
						if (status) {
							query = query.eq('status', status);
						}
						if ((args.trashed ?? 'without') === 'without') {
							query = query.eq('deletedAt', undefined);
						}
						return query;
					}),
				cursor: args.cursor,
				numItems: args.numItems
			});
			const hydrated = await buildProjectListItems(paginated.items as AdminDemoProject[], ctx);
			return {
				items: applyFieldVisibilityList({
					items: hydrated,
					user: ctx.user,
					policies: projectFieldPolicies
				}),
				continueCursor: paginated.continueCursor,
				isDone: paginated.isDone
			};
		}

		const projects = await ctx.db.query('adminDemoProjects').collect();
		const query = runResourceListQuery({
			items: projects,
			cursor: args.cursor,
			numItems: args.numItems,
			search,
			trashed: args.trashed,
			sortBy: args.sortBy,
			sortMap: {
				name: (item) => item.name,
				slug: (item) => item.slug,
				status: (item) => item.status,
				budget: (item) => item.budget,
				createdAt: (item) => item.createdAt,
				updatedAt: (item) => item.updatedAt
			},
			searchableValues: (item) => [item.name, item.slug, item.ownerEmail, item.description ?? ''],
			applyFilters: (item) => matchesProjectFilters(item, args.filters ?? {}),
			applyLens: (item) => matchesProjectLens(item, args.lens)
		});
		const hydrated = await buildProjectListItems(query.items, ctx);

		return {
			items: applyFieldVisibilityList({
				items: hydrated,
				user: ctx.user,
				policies: projectFieldPolicies
			}),
			continueCursor: query.continueCursor,
			isDone: query.isDone
		};
	}
});

export const countProjects = permissionQuery({
	args: countArgsValidator,
	handler: async (ctx, args) => {
		assertPermission(ctx.user, { resource: ['read'] });
		const search = args.search?.trim();
		const indexedQuery = getIndexedProjectQuery(ctx, {
			filters: args.filters,
			lens: args.lens,
			trashed: args.trashed
		});
		if (!search && indexedQuery) {
			return countPaginatedQuery({
				createQuery: () =>
					getIndexedProjectQuery(ctx, {
						filters: args.filters,
						lens: args.lens,
						trashed: args.trashed
					}) as any
			});
		}

		const status = resolveProjectStatus(args.filters ?? {}, args.lens);
		const canUseSearchIndex =
			Boolean(search) &&
			!(args.filters?.createdRange ?? '') &&
			!(args.filters?.budget ?? '') &&
			(!args.filters?.featured || args.filters.featured === 'all') &&
			args.lens !== 'featured' &&
			((args.trashed ?? 'without') === 'without' || (args.trashed ?? 'without') === 'with');
		if (canUseSearchIndex) {
			return countPaginatedQuery({
				createQuery: () =>
					ctx.db
						.query('adminDemoProjects')
						.withSearchIndex(projectSearchIndex.indexName, (q: any) => {
							let query = q.search(projectSearchIndex.searchField, search as string);
							if (status) {
								query = query.eq('status', status);
							}
							if ((args.trashed ?? 'without') === 'without') {
								query = query.eq('deletedAt', undefined);
							}
							return query;
						})
			});
		}

		const projects = await ctx.db.query('adminDemoProjects').collect();
		return runResourceListQuery({
			items: projects,
			numItems: projects.length || 1,
			search,
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
		const search = args.search?.trim();
		const indexedQuery = getIndexedProjectQuery(ctx, {
			filters: args.filters,
			lens: args.lens,
			trashed: args.trashed
		});
		if (!search && indexedQuery && !args.sortBy) {
			return resolveLastPageForPaginatedQuery({
				createQuery: () =>
					getIndexedProjectQuery(ctx, {
						filters: args.filters,
						lens: args.lens,
						trashed: args.trashed
					}) as any,
				numItems: args.numItems
			});
		}

		const status = resolveProjectStatus(args.filters ?? {}, args.lens);
		const canUseSearchIndex =
			Boolean(search) &&
			!args.sortBy &&
			!(args.filters?.createdRange ?? '') &&
			!(args.filters?.budget ?? '') &&
			(!args.filters?.featured || args.filters.featured === 'all') &&
			args.lens !== 'featured' &&
			((args.trashed ?? 'without') === 'without' || (args.trashed ?? 'without') === 'with');
		if (canUseSearchIndex) {
			return resolveLastPageForPaginatedQuery({
				createQuery: () =>
					ctx.db
						.query('adminDemoProjects')
						.withSearchIndex(projectSearchIndex.indexName, (q: any) => {
							let query = q.search(projectSearchIndex.searchField, search as string);
							if (status) {
								query = query.eq('status', status);
							}
							if ((args.trashed ?? 'without') === 'without') {
								query = query.eq('deletedAt', undefined);
							}
							return query;
						}),
				numItems: args.numItems
			});
		}

		const projects = await ctx.db.query('adminDemoProjects').collect();
		const totalCount = runResourceListQuery({
			items: projects,
			numItems: projects.length || 1,
			search,
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

		return applyFieldVisibility({
			item: {
				...project,
				tags: tags.filter(Boolean),
				taskCount: tasks.length,
				tagCount: pivots.length
			} as ProjectListItem,
			user: ctx.user,
			policies: projectFieldPolicies
		});
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
	coverImageUrl: v.optional(v.string()),
	specSheetUrl: v.optional(v.string()),
	settingsJson: v.optional(v.string()),
	codeSnippet: v.optional(v.string()),
	tagIds: v.optional(v.array(v.id('adminDemoTags')))
});

const updateProjectValuesValidator = v.object({
	name: v.optional(v.string()),
	slug: v.optional(v.string()),
	status: v.optional(v.union(v.literal('draft'), v.literal('active'), v.literal('archived'))),
	ownerEmail: v.optional(v.string()),
	budget: v.optional(v.number()),
	isFeatured: v.optional(v.boolean()),
	description: v.optional(v.string()),
	coverImageUrl: v.optional(v.string()),
	specSheetUrl: v.optional(v.string()),
	settingsJson: v.optional(v.string()),
	codeSnippet: v.optional(v.string()),
	tagIds: v.optional(v.array(v.id('adminDemoTags')))
});

function validateProjectValues(values: {
	name: string;
	slug: string;
	ownerEmail: string;
	budget: number;
}) {
	const fieldErrors: Record<string, string> = {};
	if (values.name.trim().length === 0) {
		fieldErrors.name = 'admin.resources.form.required';
	}
	if (values.slug.trim().length === 0) {
		fieldErrors.slug = 'admin.resources.form.required';
	}
	if (values.ownerEmail.trim().length === 0) {
		fieldErrors.ownerEmail = 'admin.resources.form.required';
	} else if (!values.ownerEmail.includes('@')) {
		fieldErrors.ownerEmail = 'admin.resources.form.invalid';
	}
	if (!Number.isFinite(values.budget) || values.budget < 0) {
		fieldErrors.budget = 'admin.resources.form.invalid';
	}
	if (Object.keys(fieldErrors).length > 0) {
		validationError(fieldErrors);
	}
}

export const createProject = permissionMutation({
	args: createProjectValuesValidator,
	handler: async (ctx, args) => {
		assertPermission(ctx.user, { resource: ['create'] });
		assertResourceCrudAllowed({
			resourceName: 'demo-projects',
			operation: 'create',
			user: ctx.user
		});
		validateProjectValues(args);
		const now = Date.now();
		const projectId = await ctx.db.insert('adminDemoProjects', {
			name: args.name,
			slug: args.slug,
			status: args.status,
			ownerEmail: args.ownerEmail,
			budget: args.budget,
			isFeatured: args.isFeatured,
			description: args.description,
			coverImageUrl: args.coverImageUrl,
			specSheetUrl: args.specSheetUrl,
			settingsJson: args.settingsJson,
			codeSnippet: args.codeSnippet,
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
		values: updateProjectValuesValidator
	},
	handler: async (ctx, args) => {
		assertPermission(ctx.user, { resource: ['update'] });
		const project = await ctx.db.get(args.id);
		if (!project) notFoundError('Project');
		assertResourceCrudAllowed({
			resourceName: 'demo-projects',
			operation: 'update',
			user: ctx.user,
			record: project as Record<string, unknown>
		});
		const readOptionalString = (value: unknown, fallback: string | undefined) =>
			typeof value === 'string' ? value : fallback;

		const nextValues = {
			name: args.values.name ?? project.name,
			slug: args.values.slug ?? project.slug,
			status: args.values.status ?? project.status,
			ownerEmail: args.values.ownerEmail ?? project.ownerEmail,
			budget: args.values.budget ?? project.budget,
			isFeatured: args.values.isFeatured ?? project.isFeatured,
			description: args.values.description ?? project.description,
			coverImageUrl: readOptionalString(
				args.values.coverImageUrl,
				typeof project.coverImageUrl === 'string' ? project.coverImageUrl : undefined
			),
			specSheetUrl: readOptionalString(
				args.values.specSheetUrl,
				typeof project.specSheetUrl === 'string' ? project.specSheetUrl : undefined
			),
			settingsJson: readOptionalString(
				args.values.settingsJson,
				typeof project.settingsJson === 'string' ? project.settingsJson : undefined
			),
			codeSnippet: readOptionalString(
				args.values.codeSnippet,
				typeof project.codeSnippet === 'string' ? project.codeSnippet : undefined
			)
		};
		validateProjectValues(nextValues);

		await ctx.db.patch(args.id, {
			...nextValues,
			updatedAt: Date.now()
		});
		if (args.values.tagIds) {
			const existing = await ctx.db
				.query('adminDemoProjectTags')
				.withIndex('by_project', (q) => q.eq('projectId', args.id))
				.collect();
			for (const row of existing) {
				await ctx.db.delete(row._id);
			}

			for (const tagId of args.values.tagIds) {
				await ctx.db.insert('adminDemoProjectTags', {
					projectId: args.id,
					tagId,
					createdAt: Date.now()
				});
			}
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
		assertResourceCrudAllowed({
			resourceName: 'demo-projects',
			operation: 'delete',
			user: ctx.user,
			record: project as Record<string, unknown>
		});
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
		assertResourceCrudAllowed({
			resourceName: 'demo-projects',
			operation: 'delete',
			user: ctx.user,
			record: project as Record<string, unknown>
		});
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
		assertResourceCrudAllowed({
			resourceName: 'demo-projects',
			operation: 'delete',
			user: ctx.user,
			record: project as Record<string, unknown>
		});

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
		assertResourceCrudAllowed({
			resourceName: 'demo-projects',
			operation: 'update',
			user: ctx.user,
			record: project as Record<string, unknown>
		});

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
			return { type: 'danger', text: 'admin.resources.actions.no_records_selected' };
		}

		if (args.action === 'attachTag') {
			if (!args.values?.tagId) {
				return { type: 'danger', text: 'admin.resources.form.required' };
			}
			for (const id of args.ids) {
				const project = await ctx.db.get(id);
				if (!project) continue;
				assertRelationAllowed({
					resourceName: 'demo-projects',
					relationField: 'tagIds',
					operation: 'attach',
					user: ctx.user,
					parentRecord: project as Record<string, unknown>
				});
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
			return success('admin.resources.toasts.action_success');
		}

		if (args.action === 'detachTag') {
			if (!args.values?.tagId) {
				return { type: 'danger', text: 'admin.resources.form.required' };
			}
			for (const id of args.ids) {
				const project = await ctx.db.get(id);
				if (!project) continue;
				assertRelationAllowed({
					resourceName: 'demo-projects',
					relationField: 'tagIds',
					operation: 'detach',
					user: ctx.user,
					parentRecord: project as Record<string, unknown>
				});
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
			return success('admin.resources.toasts.action_success');
		}

		let skipped = 0;
		for (const id of args.ids) {
			const project = await ctx.db.get(id);
			if (!project) {
				skipped++;
				continue;
			}
			if (args.action === 'feature') {
				await ctx.db.patch(id, { isFeatured: true, updatedAt: Date.now() });
			} else if (args.action === 'unfeature') {
				await ctx.db.patch(id, { isFeatured: false, updatedAt: Date.now() });
			} else if (args.action === 'archive') {
				await ctx.db.patch(id, { status: 'archived', updatedAt: Date.now() });
			}
		}

		if (skipped > 0 && skipped === args.ids.length) {
			return { type: 'danger', text: 'admin.resources.actions.records_not_found' };
		}
		return success('admin.resources.toasts.action_success');
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
		const project = await ctx.db.get(args.projectId);
		if (!project) notFoundError('Project');
		assertRelationAllowed({
			resourceName: 'demo-projects',
			relationField: 'tagIds',
			operation: 'attach',
			user: ctx.user,
			parentRecord: project as Record<string, unknown>
		});
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
		const project = await ctx.db.get(args.projectId);
		if (!project) notFoundError('Project');
		assertRelationAllowed({
			resourceName: 'demo-projects',
			relationField: 'tagIds',
			operation: 'detach',
			user: ctx.user,
			parentRecord: project as Record<string, unknown>
		});
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
	args: {
		ranges: v.optional(v.record(v.string(), v.string())),
		recordId: v.optional(v.id('adminDemoProjects'))
	},
	handler: async (ctx, args) => {
		assertPermission(ctx.user, { metric: ['read'] });

		if (args.recordId) {
			const project = await ctx.db.get(args.recordId);
			if (!project) notFoundError('Project');

			const tasks = await ctx.db
				.query('adminDemoTasks')
				.withIndex('by_project', (q) => q.eq('projectId', args.recordId!))
				.collect();

			const pivots = await ctx.db
				.query('adminDemoProjectTags')
				.withIndex('by_project', (q) => q.eq('projectId', args.recordId!))
				.collect();

			const completedTasks = tasks.filter((t) => t.status === 'done');

			return {
				cards: [
					{ key: 'taskCount', type: 'value', value: tasks.length },
					{ key: 'tagCount', type: 'value', value: pivots.length },
					{
						key: 'taskCompletion',
						type: 'progress',
						value: completedTasks.length,
						target: tasks.length
					}
				]
			};
		}

		const [activeCount, archivedCount, featuredCount, budgetTotal] = await Promise.all([
			aggregateCountProjectsByStatus(ctx, 'active'),
			aggregateCountProjectsByStatus(ctx, 'archived'),
			aggregateCountFeaturedProjects(ctx),
			aggregateSumActiveProjectBudget(ctx)
		]);

		return {
			cards: [
				{ key: 'total', type: 'value', value: activeCount + archivedCount },
				{ key: 'active', type: 'value', value: activeCount },
				{ key: 'featured', type: 'value', value: featuredCount },
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
