import ListTodoIcon from '@lucide/svelte/icons/list-todo';
import {
	defineAction,
	defineField,
	defineFilter,
	defineLens,
	defineMetric,
	defineResource
} from '../builders';

export const demoTasksResource = defineResource({
	name: 'demo-tasks',
	table: 'adminDemoTasks',
	groupKey: 'admin.resources.groups.demo_data',
	navTitleKey: 'admin.resources.tasks.nav_title',
	icon: ListTodoIcon,
	title: (record) => String(record.title ?? ''),
	subtitle: (record) => String(record.status ?? ''),
	search: ['title', 'assigneeEmail'],
	sortFields: ['title', 'status', 'priority', 'estimateHours', 'createdAt', 'updatedAt'],
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
			attribute: 'title',
			labelKey: 'admin.resources.tasks.fields.title',
			required: true,
			inlineEditable: true,
			sortable: true,
			searchable: true,
			showOnIndex: true,
			showOnDetail: true,
			showOnForm: true
		}),
		defineField({
			type: 'belongsTo',
			attribute: 'projectId',
			labelKey: 'admin.resources.tasks.fields.project',
			required: true,
			showOnIndex: true,
			showOnDetail: true,
			showOnForm: true,
			relation: {
				resourceName: 'demo-projects',
				valueField: '_id',
				labelField: 'name'
			}
		}),
		defineField({
			type: 'select',
			attribute: 'status',
			labelKey: 'admin.resources.tasks.fields.status',
			required: true,
			inlineEditable: true,
			sortable: true,
			showOnIndex: true,
			showOnDetail: true,
			showOnForm: true,
			options: [
				{ value: 'todo', labelKey: 'admin.resources.tasks.options.todo' },
				{ value: 'in_progress', labelKey: 'admin.resources.tasks.options.in_progress' },
				{ value: 'done', labelKey: 'admin.resources.tasks.options.done' }
			]
		}),
		defineField({
			type: 'select',
			attribute: 'priority',
			labelKey: 'admin.resources.tasks.fields.priority',
			required: true,
			inlineEditable: true,
			sortable: true,
			showOnIndex: true,
			showOnDetail: true,
			showOnForm: true,
			options: [
				{ value: 'low', labelKey: 'admin.resources.tasks.options.low' },
				{ value: 'medium', labelKey: 'admin.resources.tasks.options.medium' },
				{ value: 'high', labelKey: 'admin.resources.tasks.options.high' }
			]
		}),
		defineField({
			type: 'number',
			attribute: 'estimateHours',
			labelKey: 'admin.resources.tasks.fields.estimate_hours',
			required: true,
			inlineEditable: true,
			sortable: true,
			showOnIndex: true,
			showOnDetail: true,
			showOnForm: true
		}),
		defineField({
			type: 'email',
			attribute: 'assigneeEmail',
			labelKey: 'admin.resources.tasks.fields.assignee_email',
			canSee: (_user, record) => (record as { priority?: string } | undefined)?.priority === 'high',
			showOnIndex: true,
			showOnDetail: true,
			showOnForm: true
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
			labelKey: 'admin.resources.tasks.filters.status',
			type: 'select',
			urlKey: 'status',
			defaultValue: 'all',
			options: [
				{ value: 'all', labelKey: 'admin.resources.filters.all' },
				{ value: 'todo', labelKey: 'admin.resources.tasks.options.todo' },
				{ value: 'in_progress', labelKey: 'admin.resources.tasks.options.in_progress' },
				{ value: 'done', labelKey: 'admin.resources.tasks.options.done' }
			]
		}),
		defineFilter({
			key: 'priority',
			labelKey: 'admin.resources.tasks.filters.priority',
			type: 'select',
			urlKey: 'priority',
			defaultValue: 'all',
			options: [
				{ value: 'all', labelKey: 'admin.resources.filters.all' },
				{ value: 'low', labelKey: 'admin.resources.tasks.options.low' },
				{ value: 'medium', labelKey: 'admin.resources.tasks.options.medium' },
				{ value: 'high', labelKey: 'admin.resources.tasks.options.high' }
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
			key: 'markDone',
			nameKey: 'admin.resources.tasks.actions.mark_done',
			showOnIndex: true,
			showOnDetail: true
		}),
		defineAction({
			key: 'markInProgress',
			nameKey: 'admin.resources.tasks.actions.mark_in_progress',
			showOnIndex: true,
			showOnDetail: true
		})
	],
	lenses: [
		defineLens({
			key: 'due',
			nameKey: 'admin.resources.tasks.lenses.due'
		}),
		defineLens({
			key: 'completed',
			nameKey: 'admin.resources.tasks.lenses.completed'
		})
	],
	metrics: [
		defineMetric({
			key: 'todo',
			type: 'value',
			labelKey: 'admin.resources.tasks.metrics.todo',
			rangeOptions: [
				{ value: 'without', labelKey: 'admin.resources.trashed.without' },
				{ value: 'with', labelKey: 'admin.resources.trashed.with' }
			]
		}),
		defineMetric({
			key: 'inProgress',
			type: 'value',
			labelKey: 'admin.resources.tasks.metrics.in_progress'
		}),
		defineMetric({ key: 'done', type: 'value', labelKey: 'admin.resources.tasks.metrics.done' }),
		defineMetric({
			key: 'estimate',
			type: 'value',
			labelKey: 'admin.resources.tasks.metrics.estimate'
		}),
		defineMetric({
			key: 'completionRate',
			type: 'progress',
			labelKey: 'admin.resources.tasks.metrics.completion_rate'
		}),
		defineMetric({
			key: 'statusTrend',
			type: 'trend',
			labelKey: 'admin.resources.tasks.metrics.status_trend'
		}),
		defineMetric({
			key: 'prioritySplit',
			type: 'partition',
			labelKey: 'admin.resources.tasks.metrics.priority_split'
		}),
		defineMetric({
			key: 'estimateByStatus',
			type: 'table',
			labelKey: 'admin.resources.tasks.metrics.estimate_by_status'
		})
	],
	fieldGroups: [
		{
			key: 'overview',
			labelKey: 'admin.resources.groups.overview',
			contexts: ['form', 'detail', 'preview'],
			fields: ['title', 'projectId', 'status', 'priority']
		},
		{
			key: 'assignment',
			labelKey: 'admin.resources.groups.assignment',
			contexts: ['form', 'detail'],
			fields: ['assigneeEmail', 'estimateHours']
		},
		{
			key: 'system',
			labelKey: 'admin.resources.groups.system',
			contexts: ['detail'],
			fields: ['createdAt', 'updatedAt']
		}
	]
});
