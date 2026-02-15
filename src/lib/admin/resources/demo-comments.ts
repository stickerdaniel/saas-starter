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
	clickAction: 'detail',
	fields: [
		defineField({
			type: 'textarea',
			attribute: 'text',
			labelKey: 'admin.resources.comments.fields.text',
			searchable: true,
			showOnIndex: true,
			showOnDetail: true,
			showOnForm: true
		}),
		defineField({
			type: 'email',
			attribute: 'authorEmail',
			labelKey: 'admin.resources.comments.fields.author_email',
			sortable: true,
			showOnIndex: true,
			showOnDetail: true,
			showOnForm: true
		}),
		defineField({
			type: 'morphTo',
			attribute: 'target',
			labelKey: 'admin.resources.comments.fields.target',
			showOnIndex: true,
			showOnDetail: true,
			showOnForm: true
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
			labelKey: 'admin.resources.comments.metrics.total'
		}),
		defineMetric({
			key: 'project',
			type: 'partition',
			labelKey: 'admin.resources.comments.metrics.project'
		}),
		defineMetric({
			key: 'task',
			type: 'partition',
			labelKey: 'admin.resources.comments.metrics.task'
		})
	]
});
