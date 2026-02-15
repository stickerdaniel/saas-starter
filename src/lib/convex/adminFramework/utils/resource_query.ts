import { v } from 'convex/values';

export const sortDirectionValidator = v.union(v.literal('asc'), v.literal('desc'));

export const trashedFilterValidator = v.union(
	v.literal('without'),
	v.literal('with'),
	v.literal('only')
);

export const listArgsValidator = {
	cursor: v.optional(v.string()),
	numItems: v.number(),
	search: v.optional(v.string()),
	sortBy: v.optional(
		v.object({
			field: v.string(),
			direction: sortDirectionValidator
		})
	),
	trashed: v.optional(trashedFilterValidator),
	filters: v.optional(v.record(v.string(), v.string())),
	lens: v.optional(v.string())
};

export const countArgsValidator = {
	search: v.optional(v.string()),
	trashed: v.optional(trashedFilterValidator),
	filters: v.optional(v.record(v.string(), v.string())),
	lens: v.optional(v.string())
};

export const resolveLastPageArgsValidator = {
	numItems: v.number(),
	search: v.optional(v.string()),
	sortBy: v.optional(
		v.object({
			field: v.string(),
			direction: sortDirectionValidator
		})
	),
	trashed: v.optional(trashedFilterValidator),
	filters: v.optional(v.record(v.string(), v.string())),
	lens: v.optional(v.string())
};

export type QueryOptions<TItem extends Record<string, unknown>> = {
	items: TItem[];
	cursor?: string;
	numItems: number;
	search?: string;
	searchableValues: (item: TItem) => string[];
	sortBy?: { field: string; direction: 'asc' | 'desc' };
	sortMap?: Record<string, (item: TItem) => string | number | boolean | undefined | null>;
	trashed?: 'without' | 'with' | 'only';
	applyFilters?: (item: TItem) => boolean;
	applyLens?: (item: TItem) => boolean;
};

function compareValue(a: unknown, b: unknown): number {
	if (a === b) return 0;
	if (a === undefined || a === null) return -1;
	if (b === undefined || b === null) return 1;
	if (typeof a === 'number' && typeof b === 'number') return a - b;
	if (typeof a === 'boolean' && typeof b === 'boolean') return Number(a) - Number(b);
	return String(a).localeCompare(String(b));
}

export function filterTrashed<TItem extends Record<string, unknown>>(
	items: TItem[],
	trashed: 'without' | 'with' | 'only' = 'without'
) {
	const hasDeletedAt = (item: TItem) =>
		typeof (item as { deletedAt?: number }).deletedAt === 'number';

	if (trashed === 'with') return items;
	if (trashed === 'only') return items.filter((item) => hasDeletedAt(item));
	return items.filter((item) => !hasDeletedAt(item));
}

export function runResourceListQuery<TItem extends Record<string, unknown>>(
	options: QueryOptions<TItem>
) {
	let working = filterTrashed(options.items, options.trashed);

	if (options.applyLens) {
		working = working.filter(options.applyLens);
	}

	if (options.applyFilters) {
		working = working.filter(options.applyFilters);
	}

	const search = options.search?.trim().toLowerCase();
	if (search) {
		working = working.filter((item) =>
			options.searchableValues(item).some((value) => value.toLowerCase().includes(search))
		);
	}

	if (options.sortBy && options.sortMap?.[options.sortBy.field]) {
		const getter = options.sortMap[options.sortBy.field];
		const direction = options.sortBy.direction === 'asc' ? 1 : -1;
		working = [...working].sort((a, b) => compareValue(getter(a), getter(b)) * direction);
	}

	const offsetRaw = options.cursor ? Number.parseInt(options.cursor, 10) : 0;
	const offset = Number.isFinite(offsetRaw) && offsetRaw >= 0 ? offsetRaw : 0;
	const pageEnd = offset + options.numItems;
	const page = working.slice(offset, pageEnd);
	const isDone = pageEnd >= working.length;

	return {
		items: page,
		continueCursor: isDone ? null : String(pageEnd),
		isDone,
		totalCount: working.length
	};
}

export function resolveLastPage(args: { totalCount: number; numItems: number }) {
	if (args.totalCount <= 0) {
		return { page: 1, cursor: null as string | null };
	}
	const page = Math.max(1, Math.ceil(args.totalCount / args.numItems));
	const offset = (page - 1) * args.numItems;
	return {
		page,
		cursor: offset === 0 ? null : String(offset)
	};
}
