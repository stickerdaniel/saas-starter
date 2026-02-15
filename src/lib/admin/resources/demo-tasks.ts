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
	clickAction: 'detail',
	fields: [
		defineField({
			type: 'text',
			attribute: 'title',
			labelKey: 'admin.resources.tasks.fields.title',
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
			sortable: true,
			showOnIndex: true,
			showOnDetail: true,
			showOnForm: true
		}),
		defineField({
			type: 'email',
			attribute: 'assigneeEmail',
			labelKey: 'admin.resources.tasks.fields.assignee_email',
			showOnIndex: true,
			showOnDetail: true,
			showOnForm: true
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
		defineMetric({ key: 'todo', type: 'value', labelKey: 'admin.resources.tasks.metrics.todo' }),
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
		})
	]
});
