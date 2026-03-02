import ListTodoIcon from '@lucide/svelte/icons/list-todo';
import CircleDotIcon from '@lucide/svelte/icons/circle-dot';
import LoaderIcon from '@lucide/svelte/icons/loader';
import CircleCheckIcon from '@lucide/svelte/icons/circle-check';
import ClockIcon from '@lucide/svelte/icons/clock';
import ChartPieIcon from '@lucide/svelte/icons/chart-pie';
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
			},
			inlineCreatable: true
		}),
		defineField({
			type: 'select',
			attribute: 'status',
			labelKey: 'admin.resources.tasks.fields.status',
			required: true,
			filterable: true,
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
			filterable: true,
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
			icon: CircleDotIcon,
			descriptionKey: 'admin.resources.tasks.metrics.todo_desc',
			subtitleKey: 'admin.resources.tasks.metrics.todo_subtitle',
			rangeOptions: [
				{ value: 'without', labelKey: 'admin.resources.trashed.without' },
				{ value: 'with', labelKey: 'admin.resources.trashed.with' }
			]
		}),
		defineMetric({
			key: 'inProgress',
			type: 'value',
			labelKey: 'admin.resources.tasks.metrics.in_progress',
			icon: LoaderIcon,
			descriptionKey: 'admin.resources.tasks.metrics.in_progress_desc',
			subtitleKey: 'admin.resources.tasks.metrics.in_progress_subtitle'
		}),
		defineMetric({
			key: 'done',
			type: 'value',
			labelKey: 'admin.resources.tasks.metrics.done',
			icon: CircleCheckIcon,
			descriptionKey: 'admin.resources.tasks.metrics.done_desc',
			subtitleKey: 'admin.resources.tasks.metrics.done_subtitle'
		}),
		defineMetric({
			key: 'estimate',
			type: 'value',
			labelKey: 'admin.resources.tasks.metrics.estimate',
			icon: ClockIcon,
			descriptionKey: 'admin.resources.tasks.metrics.estimate_desc',
			subtitleKey: 'admin.resources.tasks.metrics.estimate_subtitle'
		}),
		defineMetric({
			key: 'completionRate',
			type: 'progress',
			labelKey: 'admin.resources.tasks.metrics.completion_rate',
			icon: ChartPieIcon,
			descriptionKey: 'admin.resources.tasks.metrics.completion_rate_desc',
			subtitleKey: 'admin.resources.tasks.metrics.completion_rate_subtitle',
			display: 'radial'
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

export const demoTasksRuntime: ResourceRuntime = {
	list: api.adminFramework.resources.tasks.listTasks,
	count: api.adminFramework.resources.tasks.countTasks,
	resolveLastPage: api.adminFramework.resources.tasks.resolveTasksLastPage,
	getById: api.adminFramework.resources.tasks.getTaskById,
	create: api.adminFramework.resources.tasks.createTask,
	update: api.adminFramework.resources.tasks.updateTask,
	delete: api.adminFramework.resources.tasks.deleteTask,
	restore: api.adminFramework.resources.tasks.restoreTask,
	forceDelete: api.adminFramework.resources.tasks.forceDeleteTask,
	replicate: api.adminFramework.resources.tasks.replicateTask,
	runAction: api.adminFramework.resources.tasks.runTaskAction,
	getMetrics: api.adminFramework.resources.tasks.getTaskMetrics,
	listRelationOptions: {
		projectId: api.adminFramework.resources.projects.listProjectOptions
	}
};

export default defineResourceModule({
	resource: demoTasksResource,
	runtime: demoTasksRuntime
});
