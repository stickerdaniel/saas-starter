import * as v from 'valibot';
import type { GenericSchema } from 'valibot';
import { error } from '@sveltejs/kit';
import { getResourceByName, getResourceRuntime } from './registry';
import type { BetterAuthUser } from '$lib/convex/admin/types';
import type { ResourceDefinition } from './types';
import { isResourceVisible } from './visibility';
import { resolveFieldFilters } from './filters';
import { parseSortParam, parsePageSize } from '$lib/tables/convex/url';

const PAGE_SIZE_OPTIONS = ['5', '10', '20', '50', '100'] as const;

export function getResourceContext(resourceName: string, viewer?: BetterAuthUser) {
	const resource = getResourceByName(resourceName);
	const runtime = getResourceRuntime(resourceName);
	if (!resource || !runtime) {
		throw error(404, 'Resource not found');
	}
	if (!isResourceVisible(resource, viewer)) {
		throw error(404, 'Resource not found');
	}

	return {
		resource,
		runtime,
		prefix: `admin-${resourceName}`
	};
}

export function getPageSizeOptions(resourcePerPageOptions?: number[]) {
	if (!resourcePerPageOptions || resourcePerPageOptions.length === 0) {
		return [...PAGE_SIZE_OPTIONS] as [string, ...string[]];
	}
	return resourcePerPageOptions.map((option) => String(option)) as [string, ...string[]];
}

export function createResourceUrlSchema(args: {
	filters: Array<{ urlKey: string; defaultValue: string }>;
	pageSizeOptions: [string, ...string[]];
	defaultPageSize: string;
}) {
	const shape: Record<string, GenericSchema> = {
		search: v.optional(v.fallback(v.string(), ''), ''),
		sort: v.optional(v.fallback(v.string(), ''), ''),
		page: v.optional(v.fallback(v.string(), '1'), '1'),
		page_size: v.optional(
			v.fallback(v.picklist(args.pageSizeOptions), args.defaultPageSize),
			args.defaultPageSize
		),
		cursor: v.optional(v.fallback(v.string(), ''), ''),
		lens: v.optional(v.fallback(v.string(), 'all'), 'all'),
		trashed: v.optional(v.fallback(v.picklist(['without', 'with', 'only']), 'without'), 'without')
	};

	for (const filter of args.filters) {
		shape[filter.urlKey] = v.optional(
			v.fallback(v.string(), filter.defaultValue),
			filter.defaultValue
		);
	}

	return v.object(shape);
}

export function getResourceTableDefaults(resource: ResourceDefinition<any>) {
	const fieldFilters = resolveFieldFilters(resource.fields);
	const allConfiguredFilters = [
		...(resource.filters ?? []),
		...fieldFilters,
		...(resource.lenses ?? []).flatMap((lens) => lens.filters ?? [])
	].filter(
		(filter, index, array) => array.findIndex((entry) => entry.urlKey === filter.urlKey) === index
	);

	const defaultFilters: Record<string, string> = {
		lens: 'all',
		trashed: 'without',
		...Object.fromEntries(
			allConfiguredFilters.map((filter) => [filter.urlKey, filter.defaultValue])
		)
	};

	const pageSizeOptions = getPageSizeOptions(resource.perPageOptions);
	const defaultPageSize = pageSizeOptions[0];
	const sortFields = (resource.sortFields?.length ? resource.sortFields : ['createdAt']) as [
		string,
		...string[]
	];

	const urlSchema = createResourceUrlSchema({
		filters: allConfiguredFilters.map((filter) => ({
			urlKey: filter.urlKey,
			defaultValue: filter.defaultValue
		})),
		pageSizeOptions,
		defaultPageSize
	});

	return {
		allConfiguredFilters,
		defaultFilters,
		pageSizeOptions,
		defaultPageSize,
		sortFields,
		urlSchema
	};
}

export function parseResourceListArgs(resource: ResourceDefinition<any>, url: URL) {
	const { allConfiguredFilters, defaultPageSize, sortFields, urlSchema } =
		getResourceTableDefaults(resource);

	const raw: Record<string, string> = {};
	for (const [key, value] of url.searchParams) {
		raw[key] = value;
	}
	const state = v.parse(urlSchema, raw) as Record<string, string>;

	const sortBy = parseSortParam(state.sort ?? '', sortFields);
	const pageSize = parsePageSize(state.page_size ?? defaultPageSize, Number(defaultPageSize));
	const search = state.search ?? '';

	const filters: Record<string, string> = {};
	for (const filter of allConfiguredFilters) {
		filters[filter.urlKey] = state[filter.urlKey] ?? filter.defaultValue;
	}

	const lens = (state.lens ?? 'all') === 'all' ? undefined : state.lens;
	const trashed = (state.trashed ?? 'without') as 'without' | 'with' | 'only';

	return {
		listArgs: {
			cursor: undefined as string | undefined,
			numItems: pageSize,
			search,
			sortBy,
			filters,
			lens,
			trashed
		},
		countArgs: {
			search,
			filters,
			lens,
			trashed
		}
	};
}
