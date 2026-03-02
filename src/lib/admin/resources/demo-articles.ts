import NewspaperIcon from '@lucide/svelte/icons/newspaper';
import HashIcon from '@lucide/svelte/icons/hash';
import ChartPieIcon from '@lucide/svelte/icons/chart-pie';
import * as vb from 'valibot';
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

export const demoArticlesResource = defineResource({
	name: 'demo-articles',
	table: 'adminDemoArticles',
	groupKey: 'admin.resources.groups.demo_data',
	navTitleKey: 'admin.resources.articles.nav_title',
	icon: NewspaperIcon,
	title: (record) => String(record.title ?? ''),
	subtitle: (record) => String(record.authorName ?? ''),
	search: ['title', 'authorName', 'slug'],
	sortFields: ['title', 'status', 'category', 'price', 'createdAt', 'updatedAt'],
	perPageOptions: [5, 10, 20, 50],
	softDeletes: true,
	badgeQuery: {
		trashed: 'without'
	},
	clickAction: 'detail',
	createButtonLabelKey: 'admin.resources.articles.buttons.publish_article',
	fields: [
		defineField({
			type: 'text',
			attribute: 'title',
			labelKey: 'admin.resources.articles.fields.title',
			required: true,
			sortable: true,
			searchable: true,
			showOnIndex: true,
			showOnDetail: true,
			showOnForm: true,
			maxlength: 200
		}),
		defineField({
			type: 'slug',
			attribute: 'slug',
			labelKey: 'admin.resources.articles.fields.slug',
			slugFrom: 'title',
			immutable: true,
			required: true,
			showOnIndex: true,
			showOnDetail: true,
			showOnForm: true
		}),
		defineField({
			type: 'avatar',
			attribute: 'authorAvatarUrl',
			labelKey: 'admin.resources.articles.fields.author_avatar',
			avatarFallback: 'initials',
			avatarNameField: 'authorName',
			indexColumn: { preset: 'avatar' },
			showOnIndex: true,
			showOnDetail: true,
			showOnForm: true
		}),
		defineField({
			type: 'text',
			attribute: 'authorName',
			labelKey: 'admin.resources.articles.fields.author_name',
			required: true,
			searchable: true,
			showOnIndex: true,
			showOnDetail: true,
			showOnForm: true,
			suggestions: ['Alice Johnson', 'Bob Smith', 'Carol Williams', 'Dave Brown', 'Eve Davis']
		}),
		defineField({
			type: 'url',
			attribute: 'websiteUrl',
			labelKey: 'admin.resources.articles.fields.website_url',
			rules: vb.pipe(vb.string(), vb.url()),
			showOnIndex: false,
			showOnDetail: true,
			showOnForm: true
		}),
		defineField({
			type: 'password',
			attribute: 'apiKey',
			labelKey: 'admin.resources.articles.fields.api_key',
			showOnIndex: false,
			showOnDetail: true,
			showOnForm: true
		}),
		defineField({
			type: 'badge',
			attribute: 'category',
			labelKey: 'admin.resources.articles.fields.category',
			required: true,
			filterable: {
				type: 'select',
				key: 'category',
				urlKey: 'category',
				defaultValue: 'all',
				options: [
					{ value: 'all', labelKey: 'admin.resources.filters.all' },
					{ value: 'tech', labelKey: 'admin.resources.articles.options.category_tech' },
					{
						value: 'business',
						labelKey: 'admin.resources.articles.options.category_business'
					},
					{ value: 'design', labelKey: 'admin.resources.articles.options.category_design' },
					{
						value: 'science',
						labelKey: 'admin.resources.articles.options.category_science'
					}
				]
			},
			sortable: true,
			indexColumn: { preset: 'badgeSm' },
			showOnIndex: true,
			showOnDetail: true,
			showOnForm: true,
			options: [
				{ value: 'tech', labelKey: 'admin.resources.articles.options.category_tech' },
				{ value: 'business', labelKey: 'admin.resources.articles.options.category_business' },
				{ value: 'design', labelKey: 'admin.resources.articles.options.category_design' },
				{ value: 'science', labelKey: 'admin.resources.articles.options.category_science' }
			]
		}),
		defineField({
			type: 'multiselect',
			attribute: 'priority',
			labelKey: 'admin.resources.articles.fields.priority',
			showOnIndex: false,
			showOnDetail: true,
			showOnForm: true,
			options: [
				{ value: 'low', labelKey: 'admin.resources.articles.options.priority_low' },
				{ value: 'medium', labelKey: 'admin.resources.articles.options.priority_medium' },
				{ value: 'high', labelKey: 'admin.resources.articles.options.priority_high' },
				{ value: 'critical', labelKey: 'admin.resources.articles.options.priority_critical' }
			]
		}),
		defineField({
			type: 'status',
			attribute: 'status',
			labelKey: 'admin.resources.articles.fields.status',
			required: true,
			filterable: true,
			sortable: true,
			showOnIndex: true,
			showOnDetail: true,
			showOnForm: true,
			defaultValue: 'draft',
			statusMapping: {
				draft: {
					labelKey: 'admin.resources.articles.options.status_draft',
					variant: 'secondary'
				},
				published: {
					labelKey: 'admin.resources.articles.options.status_published',
					variant: 'default'
				},
				archived: {
					labelKey: 'admin.resources.articles.options.status_archived',
					variant: 'outline'
				}
			},
			options: [
				{ value: 'draft', labelKey: 'admin.resources.articles.options.status_draft' },
				{ value: 'published', labelKey: 'admin.resources.articles.options.status_published' },
				{ value: 'archived', labelKey: 'admin.resources.articles.options.status_archived' }
			]
		}),
		defineField({
			type: 'currency',
			attribute: 'price',
			labelKey: 'admin.resources.articles.fields.price',
			required: true,
			currencyCode: 'EUR',
			currencyLocale: 'de-DE',
			sortable: true,
			indexColumn: { preset: 'currency', fixed: true },
			showOnIndex: true,
			showOnDetail: true,
			showOnForm: true
		}),
		defineField({
			type: 'boolean',
			attribute: 'isPublished',
			labelKey: 'admin.resources.articles.fields.is_published',
			dependsOn: { field: 'status', value: 'published' },
			showOnIndex: false,
			showOnDetail: true,
			showOnForm: true
		}),
		defineField({
			type: 'datetime',
			attribute: 'publishedAt',
			labelKey: 'admin.resources.articles.fields.published_at',
			dependsOn: { field: 'isPublished', predicate: (v) => v === true },
			showOnIndex: false,
			showOnDetail: true,
			showOnForm: true
		}),
		defineField({
			type: 'textarea',
			attribute: 'body',
			labelKey: 'admin.resources.articles.fields.body',
			helpTextKey: 'admin.resources.articles.fields.body_help',
			placeholderKey: 'admin.resources.articles.fields.body_placeholder',
			showOnIndex: false,
			showOnDetail: true,
			showOnForm: true,
			expandable: true,
			maxlength: 5000,
			enforceMaxlength: true
		}),
		defineField({
			type: 'heading',
			attribute: '_settings_heading',
			labelKey: 'admin.resources.articles.fields.settings_heading',
			showOnIndex: false,
			showOnDetail: true,
			showOnForm: true
		}),
		defineField({
			type: 'multiselect',
			attribute: 'tags',
			labelKey: 'admin.resources.articles.fields.tags',
			showOnIndex: false,
			showOnDetail: true,
			showOnForm: true,
			options: [
				{ value: 'featured', labelKey: 'admin.resources.articles.options.tag_featured' },
				{ value: 'trending', labelKey: 'admin.resources.articles.options.tag_trending' },
				{ value: 'editorial', labelKey: 'admin.resources.articles.options.tag_editorial' },
				{ value: 'sponsored', labelKey: 'admin.resources.articles.options.tag_sponsored' }
			]
		}),
		defineField({
			type: 'booleanGroup',
			attribute: 'permissions',
			labelKey: 'admin.resources.articles.fields.permissions',
			showOnIndex: false,
			showOnDetail: true,
			showOnForm: true,
			options: [
				{ value: 'canRead', labelKey: 'admin.resources.articles.options.perm_read' },
				{ value: 'canWrite', labelKey: 'admin.resources.articles.options.perm_write' },
				{ value: 'canDelete', labelKey: 'admin.resources.articles.options.perm_delete' },
				{ value: 'canAdmin', labelKey: 'admin.resources.articles.options.perm_admin' }
			]
		}),
		defineField({
			type: 'keyValue',
			attribute: 'metadata',
			labelKey: 'admin.resources.articles.fields.metadata',
			showOnIndex: false,
			showOnDetail: true,
			showOnForm: true
		}),
		defineField({
			type: 'hidden',
			attribute: 'internalRef',
			labelKey: 'admin.resources.articles.fields.internal_ref',
			fillUsing: () => `ref-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
			showOnIndex: false,
			showOnDetail: false,
			showOnForm: false
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
			key: 'publish',
			nameKey: 'admin.resources.articles.actions.publish',
			showOnIndex: true,
			showOnDetail: true
		}),
		defineAction({
			key: 'unpublish',
			nameKey: 'admin.resources.articles.actions.unpublish',
			chunkSize: 5,
			showOnIndex: true,
			showOnDetail: true
		})
	],
	lenses: [
		defineLens({
			key: 'published',
			nameKey: 'admin.resources.articles.lenses.published'
		}),
		defineLens({
			key: 'drafts',
			nameKey: 'admin.resources.articles.lenses.drafts'
		})
	],
	metrics: [
		defineMetric({
			key: 'total',
			type: 'value',
			labelKey: 'admin.resources.articles.metrics.total',
			icon: HashIcon,
			descriptionKey: 'admin.resources.articles.metrics.total_desc',
			subtitleKey: 'admin.resources.articles.metrics.total_subtitle'
		}),
		defineMetric({
			key: 'publishedRate',
			type: 'progress',
			labelKey: 'admin.resources.articles.metrics.published_rate',
			icon: ChartPieIcon,
			format: 'percent'
		})
	],
	fieldGroups: [
		{
			key: 'overview',
			labelKey: 'admin.resources.groups.overview',
			contexts: ['form', 'detail', 'preview'],
			fields: [
				'title',
				'slug',
				'authorAvatarUrl',
				'authorName',
				'websiteUrl',
				'apiKey',
				'category',
				'priority',
				'status',
				'price',
				'isPublished',
				'publishedAt'
			]
		},
		{
			key: 'content',
			labelKey: 'admin.resources.groups.content',
			contexts: ['form', 'detail'],
			fields: ['body']
		},
		{
			key: 'settings',
			labelKey: 'admin.resources.articles.groups.settings',
			contexts: ['form', 'detail'],
			fields: ['_settings_heading', 'tags', 'permissions', 'metadata', 'internalRef']
		},
		{
			key: 'system',
			labelKey: 'admin.resources.groups.system',
			contexts: ['detail'],
			fields: ['createdAt', 'updatedAt']
		}
	]
});

export const demoArticlesRuntime: ResourceRuntime = {
	list: api.adminFramework.resources.articles.listArticles,
	count: api.adminFramework.resources.articles.countArticles,
	resolveLastPage: api.adminFramework.resources.articles.resolveArticlesLastPage,
	getById: api.adminFramework.resources.articles.getArticleById,
	create: api.adminFramework.resources.articles.createArticle,
	update: api.adminFramework.resources.articles.updateArticle,
	delete: api.adminFramework.resources.articles.deleteArticle,
	restore: api.adminFramework.resources.articles.restoreArticle,
	forceDelete: api.adminFramework.resources.articles.forceDeleteArticle,
	replicate: api.adminFramework.resources.articles.replicateArticle,
	runAction: api.adminFramework.resources.articles.runArticleAction,
	getMetrics: api.adminFramework.resources.articles.getArticleMetrics
};

export default defineResourceModule({
	resource: demoArticlesResource,
	runtime: demoArticlesRuntime
});
