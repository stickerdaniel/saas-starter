import { localizedHref } from '$lib/utils/i18n';
import { getResourceRuntime } from '$lib/admin/registry';
import { isResourceVisible, type ViewerUser } from '$lib/admin/visibility';
import type { ResourceDefinition } from '$lib/admin/types';

export const RESOURCE_SEARCH_MIN_QUERY_LENGTH = 2;
export const RESOURCE_SEARCH_DEBOUNCE_MS = 180;
export const RESOURCE_SEARCH_MAX_ITEMS = 24;
export const RESOURCE_SEARCH_ITEMS_PER_RESOURCE = 3;

export type ResourceSearchItem = {
	id: string;
	label: string;
	localizedUrl: string;
	value: string;
	keywords: string[];
};

type TranslateFn = (key: string) => string;

function defaultFiltersForResource(resource: {
	filters?: Array<{ urlKey: string; defaultValue: string }>;
}) {
	return Object.fromEntries(
		(resource.filters ?? []).map((filter) => [filter.urlKey, filter.defaultValue])
	);
}

export async function fetchResourceSearchItems(args: {
	client: { query: (...args: any[]) => Promise<unknown> };
	query: string;
	resources: readonly ResourceDefinition<any>[];
	viewerUser: ViewerUser;
	translate: TranslateFn;
}) {
	const visibleResources = args.resources.filter((resource) => {
		if (!isResourceVisible(resource, args.viewerUser)) return false;
		// Respect globallySearchable: explicit false excludes, default true if search fields exist
		if (resource.globallySearchable === false) return false;
		if (
			resource.globallySearchable === undefined &&
			(!resource.search || resource.search.length === 0)
		)
			return false;
		return true;
	});

	const settled = await Promise.allSettled(
		visibleResources.map(async (resource) => {
			const runtime = getResourceRuntime(resource.name);
			if (!runtime) return [];
			const response = (await args.client.query(runtime.list, {
				cursor: undefined,
				numItems: RESOURCE_SEARCH_ITEMS_PER_RESOURCE,
				search: args.query,
				trashed: resource.softDeletes ? 'with' : undefined,
				filters: defaultFiltersForResource(resource),
				lens: undefined
			} as never)) as {
				items?: Array<Record<string, unknown>>;
			};
			const resourceLabel = args.translate(resource.navTitleKey);
			return (response.items ?? [])
				.filter((item) => item && typeof item === 'object')
				.map((item) => {
					const title = resource.title(item as never);
					const subtitle = resource.subtitle ? resource.subtitle(item as never) : '';
					const id = String(item._id ?? '');
					return {
						id: `resource:${resource.name}:${id}`,
						label: `${resourceLabel}: ${title}`,
						localizedUrl: localizedHref(`/admin/${resource.name}/${id}`),
						value: `${resourceLabel} ${title} ${subtitle}`.trim(),
						keywords: [resource.name, title, subtitle].filter((entry) => entry.length > 0)
					} satisfies ResourceSearchItem;
				});
		})
	);

	return {
		hadError: settled.some((result) => result.status === 'rejected'),
		items: settled
			.filter((result): result is PromiseFulfilledResult<ResourceSearchItem[]> => {
				return result.status === 'fulfilled';
			})
			.flatMap((result) => result.value)
			.slice(0, RESOURCE_SEARCH_MAX_ITEMS)
	};
}
