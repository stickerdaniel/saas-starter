export type ResourceSearchIndexConfig = {
	resourceName: string;
	table: string;
	indexName: string;
	searchField: string;
};

export const RESOURCE_SEARCH_INDEXES = {
	'demo-projects': {
		resourceName: 'demo-projects',
		table: 'adminDemoProjects',
		indexName: 'search_name_description',
		searchField: 'name'
	},
	'demo-tasks': {
		resourceName: 'demo-tasks',
		table: 'adminDemoTasks',
		indexName: 'search_title',
		searchField: 'title'
	},
	'demo-comments': {
		resourceName: 'demo-comments',
		table: 'adminDemoComments',
		indexName: 'search_text',
		searchField: 'text'
	},
	'demo-tags': {
		resourceName: 'demo-tags',
		table: 'adminDemoTags',
		indexName: 'search_name',
		searchField: 'name'
	}
} as const satisfies Record<string, ResourceSearchIndexConfig>;

export function getResourceSearchIndexConfig<T extends keyof typeof RESOURCE_SEARCH_INDEXES>(
	resourceName: T
) {
	return RESOURCE_SEARCH_INDEXES[resourceName];
}
