import TagsIcon from '@lucide/svelte/icons/tags';
import HashIcon from '@lucide/svelte/icons/hash';
import { api } from '$lib/convex/_generated/api';
import {
	defineField,
	defineFilter,
	defineMetric,
	defineResource,
	defineResourceModule
} from '../builders';
import type { ResourceRuntime } from '../types';

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
	badgeQuery: {
		trashed: 'without'
	},
	clickAction: 'preview',
	canCreate: (user) => user.role === 'admin',
	canUpdate: (user) => user.role === 'admin',
	canDelete: (user) => user.role === 'admin',
	fields: [
		defineField({
			type: 'text',
			attribute: 'name',
			labelKey: 'admin.resources.tags.fields.name',
			required: true,
			inlineEditable: true,
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
			required: true,
			inlineEditable: true,
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
	metrics: [
		defineMetric({
			key: 'total',
			type: 'value',
			labelKey: 'admin.resources.tags.metrics.total',
			icon: HashIcon,
			descriptionKey: 'admin.resources.tags.metrics.total_desc',
			subtitleKey: 'admin.resources.tags.metrics.total_subtitle'
		})
	],
	fieldGroups: [
		{
			key: 'overview',
			labelKey: 'admin.resources.groups.overview',
			contexts: ['form', 'detail', 'preview'],
			fields: ['name', 'color']
		},
		{
			key: 'system',
			labelKey: 'admin.resources.groups.system',
			contexts: ['detail'],
			fields: ['createdAt', 'updatedAt']
		}
	]
});

export const demoTagsRuntime: ResourceRuntime = {
	list: api.adminFramework.resources.tags.listTags,
	count: api.adminFramework.resources.tags.countTags,
	resolveLastPage: api.adminFramework.resources.tags.resolveTagsLastPage,
	getById: api.adminFramework.resources.tags.getTagById,
	create: api.adminFramework.resources.tags.createTag,
	update: api.adminFramework.resources.tags.updateTag,
	delete: api.adminFramework.resources.tags.deleteTag,
	restore: api.adminFramework.resources.tags.restoreTag,
	forceDelete: api.adminFramework.resources.tags.forceDeleteTag,
	replicate: api.adminFramework.resources.tags.replicateTag,
	runAction: api.adminFramework.resources.tags.runTagAction,
	getMetrics: api.adminFramework.resources.tags.getTagMetrics
};

export default defineResourceModule({
	resource: demoTagsResource,
	runtime: demoTagsRuntime
});
