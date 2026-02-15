import FolderKanbanIcon from '@lucide/svelte/icons/folder-kanban';
import {
	defineAction,
	defineField,
	defineFilter,
	defineLens,
	defineMetric,
	defineResource
} from '../builders';

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
	clickAction: 'detail',
	fields: [
		defineField({
			type: 'text',
			attribute: 'name',
			labelKey: 'admin.resources.projects.fields.name',
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
			searchable: true,
			showOnIndex: true,
			showOnDetail: true,
			showOnForm: true
		}),
		defineField({
			type: 'number',
			attribute: 'budget',
			labelKey: 'admin.resources.projects.fields.budget',
			sortable: true,
			showOnIndex: true,
			showOnDetail: true,
			showOnForm: true
		}),
		defineField({
			type: 'boolean',
			attribute: 'isFeatured',
			labelKey: 'admin.resources.projects.fields.featured',
			showOnIndex: true,
			showOnDetail: true,
			showOnForm: true
		}),
		defineField({
			type: 'textarea',
			attribute: 'description',
			labelKey: 'admin.resources.projects.fields.description',
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
			labelKey: 'admin.resources.projects.metrics.total'
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
			labelKey: 'admin.resources.projects.metrics.budget'
		})
	]
});
