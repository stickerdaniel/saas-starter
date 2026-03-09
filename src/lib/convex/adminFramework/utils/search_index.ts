export type ResourceSearchIndexConfig = {
	resourceName: string;
	table: string;
	indexName: string;
	searchField: string;
	softDeletes?: boolean;
};

export const RESOURCE_SEARCH_INDEXES = {
	'demo-projects': {
		resourceName: 'demo-projects',
		table: 'adminDemoProjects',
		indexName: 'search_name_description',
		searchField: 'name',
		softDeletes: true
	},
	'demo-tasks': {
		resourceName: 'demo-tasks',
		table: 'adminDemoTasks',
		indexName: 'search_title',
		searchField: 'title',
		softDeletes: true
	},
	'demo-comments': {
		resourceName: 'demo-comments',
		table: 'adminDemoComments',
		indexName: 'search_text',
		searchField: 'text',
		softDeletes: true
	},
	'demo-tags': {
		resourceName: 'demo-tags',
		table: 'adminDemoTags',
		indexName: 'search_name',
		searchField: 'name',
		softDeletes: false
	},
	'demo-articles': {
		resourceName: 'demo-articles',
		table: 'adminDemoArticles',
		indexName: 'search_title_author',
		searchField: 'title',
		softDeletes: true
	}
} as const satisfies Record<string, ResourceSearchIndexConfig>;

export function getResourceSearchIndexConfig<T extends keyof typeof RESOURCE_SEARCH_INDEXES>(
	resourceName: T
) {
	return RESOURCE_SEARCH_INDEXES[resourceName];
}
