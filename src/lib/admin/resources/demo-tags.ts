import TagsIcon from '@lucide/svelte/icons/tags';
import { defineField, defineMetric, defineResource } from '../builders';

export const demoTagsResource = defineResource({
	name: 'demo-tags',
	table: 'adminDemoTags',
	groupKey: 'admin.resources.groups.demo_data',
	navTitleKey: 'admin.resources.tags.nav_title',
	icon: TagsIcon,
	title: (record) => String(record.name ?? ''),
	subtitle: () => '',
	search: ['name'],
	sortFields: ['name', 'createdAt'],
	perPageOptions: [10, 20, 50],
	clickAction: 'detail',
	fields: [
		defineField({
			type: 'text',
			attribute: 'name',
			labelKey: 'admin.resources.tags.fields.name',
			sortable: true,
			searchable: true,
			showOnIndex: true,
			showOnDetail: true,
			showOnForm: true
		}),
		defineField({
			type: 'text',
			attribute: 'color',
			labelKey: 'admin.resources.tags.fields.color',
			showOnIndex: true,
			showOnDetail: true,
			showOnForm: true
		})
	],
	metrics: [
		defineMetric({ key: 'total', type: 'value', labelKey: 'admin.resources.tags.metrics.total' })
	]
});
