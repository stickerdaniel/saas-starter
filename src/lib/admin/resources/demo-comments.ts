import MessageSquareTextIcon from '@lucide/svelte/icons/message-square-text';
import {
	defineAction,
	defineField,
	defineFilter,
	defineLens,
	defineMetric,
	defineResource
} from '../builders';

export const demoCommentsResource = defineResource({
	name: 'demo-comments',
	table: 'adminDemoComments',
	groupKey: 'admin.resources.groups.demo_data',
	navTitleKey: 'admin.resources.comments.nav_title',
	icon: MessageSquareTextIcon,
	title: (record) => String(record.text ?? ''),
	subtitle: (record) => String(record.authorEmail ?? ''),
	search: ['text', 'authorEmail'],
	sortFields: ['createdAt', 'updatedAt', 'authorEmail'],
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
			type: 'textarea',
			attribute: 'text',
			labelKey: 'admin.resources.comments.fields.text',
			required: true,
			searchable: true,
			showOnIndex: true,
			showOnDetail: true,
			showOnForm: true
		}),
		defineField({
			type: 'email',
			attribute: 'authorEmail',
			labelKey: 'admin.resources.comments.fields.author_email',
			canSee: (_user, record) =>
				(record as { targetKind?: string; target?: { kind?: string } } | undefined)?.targetKind ===
					'project' ||
				(record as { target?: { kind?: string } } | undefined)?.target?.kind === 'project',
			required: true,
			sortable: true,
			showOnIndex: true,
			showOnDetail: true,
			showOnForm: true
		}),
		defineField({
			type: 'morphTo',
			attribute: 'target',
			labelKey: 'admin.resources.comments.fields.target',
			required: true,
			showOnIndex: true,
			showOnDetail: true,
			showOnForm: true,
			morphTo: {
				targets: [
					{
						kind: 'project',
						resourceName: 'demo-projects',
						labelKey: 'admin.resources.comments.options.project'
					},
					{
						kind: 'task',
						resourceName: 'demo-tasks',
						labelKey: 'admin.resources.comments.options.task'
					}
				]
			}
		}),
		defineField({
			type: 'datetime',
			attribute: 'createdAt',
			labelKey: 'admin.resources.fields.created_at',
			showOnIndex: false,
			showOnDetail: true,
			showOnForm: false
		})
	],
	filters: [
		defineFilter({
			key: 'targetKind',
			labelKey: 'admin.resources.comments.filters.target_kind',
			type: 'select',
			urlKey: 'target_kind',
			defaultValue: 'all',
			options: [
				{ value: 'all', labelKey: 'admin.resources.filters.all' },
				{ value: 'project', labelKey: 'admin.resources.comments.options.project' },
				{ value: 'task', labelKey: 'admin.resources.comments.options.task' }
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
			key: 'markReviewed',
			nameKey: 'admin.resources.comments.actions.mark_reviewed',
			showOnIndex: true,
			showOnDetail: true,
			withoutConfirmation: true
		})
	],
	lenses: [
		defineLens({
			key: 'project',
			nameKey: 'admin.resources.comments.lenses.project'
		}),
		defineLens({
			key: 'task',
			nameKey: 'admin.resources.comments.lenses.task'
		})
	],
	metrics: [
		defineMetric({
			key: 'total',
			type: 'value',
			labelKey: 'admin.resources.comments.metrics.total',
			rangeOptions: [
				{ value: 'without', labelKey: 'admin.resources.trashed.without' },
				{ value: 'with', labelKey: 'admin.resources.trashed.with' }
			]
		}),
		defineMetric({
			key: 'targetDistribution',
			type: 'partition',
			labelKey: 'admin.resources.comments.metrics.target_distribution'
		})
	],
	fieldGroups: [
		{
			key: 'overview',
			labelKey: 'admin.resources.groups.overview',
			contexts: ['form', 'detail', 'preview'],
			fields: ['text', 'authorEmail', 'target']
		},
		{
			key: 'system',
			labelKey: 'admin.resources.groups.system',
			contexts: ['detail'],
			fields: ['createdAt']
		}
	]
});
