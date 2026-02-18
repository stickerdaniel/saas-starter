import * as v from 'valibot';
import type { GenericSchema } from 'valibot';
import { error } from '@sveltejs/kit';
import { getResourceByName, getResourceRuntime } from './registry';
import type { BetterAuthUser } from '$lib/convex/admin/types';
import { isResourceVisible } from './visibility';

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
