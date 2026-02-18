import FolderKanbanIcon from '@lucide/svelte/icons/folder-kanban';
import { api } from '$lib/convex/_generated/api';
import {
	defineAction,
	defineField,
	defineFilter,
	defineLens,
	defineMetric,
	defineResource,
	defineResourceModule
} from '../builders';
import type { ResourceRuntime } from '../types';

export const demoProjectsResource = defineResource({
	name: 'demo-projects',
	table: 'adminDemoProjects',
	groupKey: 'admin.resources.groups.demo_data',
	navTitleKey: 'admin.resources.projects.nav_title',
	icon: FolderKanbanIcon,
	title: (record) => String(record.name ?? ''),
	subtitle: (record) => String(record.slug ?? ''),
	search: ['name', 'slug', 'ownerEmail'],
	sortFields: ['name', 'status', 'budget', 'createdAt', 'updatedAt'],
	perPageOptions: [5, 10, 20, 50],
	softDeletes: true,
	badgeQuery: {
		trashed: 'without'
	},
	clickAction: 'detail',
	canCreate: (user) => user.role === 'admin',
	canUpdate: (user) => user.role === 'admin',
	canDelete: (user) => user.role === 'admin',
	fields: [
		defineField({
			type: 'text',
			attribute: 'name',
			labelKey: 'admin.resources.projects.fields.name',
			required: true,
			sortable: true,
			searchable: true,
			showOnIndex: true,
			showOnDetail: true,
			showOnForm: true
		}),
		defineField({
			type: 'text',
			attribute: 'slug',
			labelKey: 'admin.resources.projects.fields.slug',
			required: true,
			sortable: true,
			searchable: true,
			showOnIndex: true,
			showOnDetail: true,
			showOnForm: true
		}),
		defineField({
			type: 'select',
			attribute: 'status',
			labelKey: 'admin.resources.projects.fields.status',
			required: true,
			sortable: true,
			showOnIndex: true,
			showOnDetail: true,
			showOnForm: true,
			options: [
				{ value: 'draft', labelKey: 'admin.resources.projects.options.status_draft' },
				{ value: 'active', labelKey: 'admin.resources.projects.options.status_active' },
				{ value: 'archived', labelKey: 'admin.resources.projects.options.status_archived' }
			]
		}),
		defineField({
			type: 'email',
			attribute: 'ownerEmail',
			labelKey: 'admin.resources.projects.fields.owner_email',
			required: true,
			inlineEditable: true,
			searchable: true,
			showOnIndex: true,
			showOnDetail: true,
			showOnForm: true
		}),
		defineField({
			type: 'number',
			attribute: 'budget',
			labelKey: 'admin.resources.projects.fields.budget',
			required: true,
			inlineEditable: true,
			sortable: true,
			showOnIndex: true,
			showOnDetail: true,
			showOnForm: true
		}),
		defineField({
			type: 'boolean',
			attribute: 'isFeatured',
			labelKey: 'admin.resources.projects.fields.featured',
			inlineEditable: true,
			showOnIndex: true,
			showOnDetail: true,
			showOnForm: true
		}),
		defineField({
			type: 'markdown',
			attribute: 'description',
			labelKey: 'admin.resources.projects.fields.description',
			showOnIndex: false,
			showOnDetail: true,
			showOnForm: true
		}),
		defineField({
			type: 'image',
			attribute: 'coverImageUrl',
			labelKey: 'admin.resources.projects.fields.cover_image',
			showOnIndex: false,
			showOnDetail: true,
			showOnForm: true
		}),
		defineField({
			type: 'file',
			attribute: 'specSheetUrl',
			labelKey: 'admin.resources.projects.fields.spec_sheet',
			showOnIndex: false,
			showOnDetail: true,
			showOnForm: true
		}),
		defineField({
			type: 'json',
			attribute: 'settingsJson',
			labelKey: 'admin.resources.projects.fields.settings_json',
			showOnIndex: false,
			showOnDetail: true,
			showOnForm: true
		}),
		defineField({
			type: 'code',
			attribute: 'codeSnippet',
			labelKey: 'admin.resources.projects.fields.code_snippet',
			canSee: (_user, record) =>
				Boolean((record as { isFeatured?: boolean } | undefined)?.isFeatured),
			showOnIndex: false,
			showOnDetail: true,
			showOnForm: true
		}),
		defineField({
			type: 'manyToMany',
			attribute: 'tagIds',
			labelKey: 'admin.resources.projects.fields.tags',
			showOnDetail: true,
			showOnForm: true,
			relation: {
				resourceName: 'demo-tags',
				valueField: '_id',
				labelField: 'name'
			}
		}),
		defineField({
			type: 'hasMany',
			attribute: 'taskCount',
			labelKey: 'admin.resources.projects.fields.tasks',
			showOnIndex: true,
			showOnDetail: true,
			showOnForm: false,
			relation: {
				resourceName: 'demo-tasks',
				valueField: '_id',
				labelField: 'title',
				foreignKey: 'projectId'
			}
		}),
		defineField({
			type: 'date',
			attribute: 'createdAt',
			labelKey: 'admin.resources.fields.created_at',
			showOnIndex: false,
			showOnDetail: true,
			showOnForm: false
		}),
		defineField({
			type: 'datetime',
			attribute: 'updatedAt',
			labelKey: 'admin.resources.fields.updated_at',
			showOnIndex: false,
			showOnDetail: true,
			showOnForm: false
		})
	],
	filters: [
		defineFilter({
			key: 'status',
			labelKey: 'admin.resources.projects.filters.status',
			type: 'select',
			urlKey: 'status',
			defaultValue: 'all',
			options: [
				{ value: 'all', labelKey: 'admin.resources.filters.all' },
				{ value: 'draft', labelKey: 'admin.resources.projects.options.status_draft' },
				{ value: 'active', labelKey: 'admin.resources.projects.options.status_active' },
				{ value: 'archived', labelKey: 'admin.resources.projects.options.status_archived' }
			]
		}),
		defineFilter({
			key: 'featured',
			labelKey: 'admin.resources.projects.filters.featured',
			type: 'select',
			urlKey: 'featured',
			defaultValue: 'all',
			options: [
				{ value: 'all', labelKey: 'admin.resources.filters.all' },
				{ value: 'featured', labelKey: 'admin.resources.projects.filters.featured_only' },
				{ value: 'regular', labelKey: 'admin.resources.projects.filters.regular_only' }
			]
		}),
		defineFilter({
			key: 'createdRange',
			labelKey: 'admin.resources.filters.created_range',
			type: 'date-range',
			urlKey: 'createdRange',
			defaultValue: '',
			options: []
		})
	],
	actions: [
		defineAction({
			key: 'feature',
			nameKey: 'admin.resources.projects.actions.feature',
			showOnIndex: true,
			showOnDetail: true
		}),
		defineAction({
			key: 'archive',
			nameKey: 'admin.resources.projects.actions.archive',
			showOnIndex: true,
			showOnDetail: true
		}),
		defineAction({
			key: 'attachTag',
			nameKey: 'admin.resources.projects.actions.attach_tag',
			showOnIndex: true,
			showOnDetail: true,
			fields: [
				defineField({
					type: 'select',
					attribute: 'tagId',
					labelKey: 'admin.resources.projects.fields.tag',
					showOnForm: true,
					options: []
				})
			]
		})
	],
	lenses: [
		defineLens({
			key: 'featured',
			nameKey: 'admin.resources.projects.lenses.featured'
		}),
		defineLens({
			key: 'archived',
			nameKey: 'admin.resources.projects.lenses.archived'
		}),
		defineLens({
			key: 'active',
			nameKey: 'admin.resources.projects.lenses.active'
		})
	],
	metrics: [
		defineMetric({
			key: 'total',
			type: 'value',
			labelKey: 'admin.resources.projects.metrics.total',
			rangeOptions: [
				{ value: 'without', labelKey: 'admin.resources.trashed.without' },
				{ value: 'with', labelKey: 'admin.resources.trashed.with' }
			]
		}),
		defineMetric({
			key: 'active',
			type: 'value',
			labelKey: 'admin.resources.projects.metrics.active'
		}),
		defineMetric({
			key: 'featured',
			type: 'value',
			labelKey: 'admin.resources.projects.metrics.featured'
		}),
		defineMetric({
			key: 'budget',
			type: 'value',
			labelKey: 'admin.resources.projects.metrics.budget',
			format: 'currency'
		})
	],
	fieldGroups: [
		{
			key: 'overview',
			labelKey: 'admin.resources.groups.overview',
			contexts: ['form', 'detail', 'preview'],
			fields: ['name', 'slug', 'status', 'ownerEmail', 'budget', 'isFeatured']
		},
		{
			key: 'content',
			labelKey: 'admin.resources.groups.content',
			contexts: ['form', 'detail'],
			fields: ['description', 'coverImageUrl', 'specSheetUrl', 'settingsJson', 'codeSnippet']
		},
		{
			key: 'relations',
			labelKey: 'admin.resources.groups.relations',
			contexts: ['form', 'detail'],
			fields: ['tagIds', 'taskCount']
		},
		{
			key: 'system',
			labelKey: 'admin.resources.groups.system',
			contexts: ['detail'],
			fields: ['createdAt', 'updatedAt']
		}
	]
});

export const demoProjectsRuntime: ResourceRuntime = {
	list: api.adminFramework.resources.projects.listProjects,
	count: api.adminFramework.resources.projects.countProjects,
	resolveLastPage: api.adminFramework.resources.projects.resolveProjectsLastPage,
	getById: api.adminFramework.resources.projects.getProjectById,
	create: api.adminFramework.resources.projects.createProject,
	update: api.adminFramework.resources.projects.updateProject,
	delete: api.adminFramework.resources.projects.deleteProject,
	restore: api.adminFramework.resources.projects.restoreProject,
	forceDelete: api.adminFramework.resources.projects.forceDeleteProject,
	replicate: api.adminFramework.resources.projects.replicateProject,
	runAction: api.adminFramework.resources.projects.runProjectAction,
	getMetrics: api.adminFramework.resources.projects.getProjectMetrics,
	listRelationOptions: {
		tagId: api.adminFramework.resources.projects.listProjectTagOptions,
		tagIds: api.adminFramework.resources.projects.listProjectTagOptions
	}
};

export default defineResourceModule({
	resource: demoProjectsResource,
	runtime: demoProjectsRuntime
});
