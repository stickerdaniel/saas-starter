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

type PaginateResult<TItem> = {
	page: TItem[];
	continueCursor: string | null;
	isDone: boolean;
};

type PaginatedQuery<TItem> = {
	paginate: (opts: { cursor: string | null; numItems: number }) => Promise<PaginateResult<TItem>>;
	order?: (direction: 'asc' | 'desc') => PaginatedQuery<TItem>;
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
	if (!Number.isFinite(options.numItems) || options.numItems < 1) {
		throw new Error('numItems must be a positive integer');
	}
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
	const numItems = Number.isFinite(args.numItems) && args.numItems > 0 ? args.numItems : 10;
	if (args.totalCount <= 0) {
		return { page: 1, cursor: null as string | null };
	}
	const page = Math.max(1, Math.ceil(args.totalCount / numItems));
	const offset = (page - 1) * numItems;
	return {
		page,
		cursor: offset === 0 ? null : String(offset)
	};
}

export async function runPaginatedListQuery<TItem extends Record<string, unknown>>(args: {
	query: PaginatedQuery<TItem>;
	cursor?: string;
	numItems: number;
	order?: 'asc' | 'desc';
}) {
	const query = args.order && args.query.order ? args.query.order(args.order) : args.query;
	const result = await query.paginate({
		cursor: args.cursor ?? null,
		numItems: args.numItems
	});
	return {
		items: result.page,
		continueCursor: result.continueCursor,
		isDone: result.isDone
	};
}

async function countPaginatedQueryInternal<TItem extends Record<string, unknown>>(
	query: PaginatedQuery<TItem>,
	stride = 1000
) {
	let total = 0;
	let cursor: string | null = null;
	while (true) {
		const result = await query.paginate({
			cursor,
			numItems: stride
		});
		total += result.page.length;
		if (result.isDone || !result.continueCursor) {
			break;
		}
		cursor = result.continueCursor;
	}
	return total;
}

export async function countPaginatedQuery<TItem extends Record<string, unknown>>(args: {
	createQuery: () => PaginatedQuery<TItem>;
	order?: 'asc' | 'desc';
	stride?: number;
}) {
	const query = args.createQuery();
	const ordered = args.order && query.order ? query.order(args.order) : query;
	return countPaginatedQueryInternal(ordered, args.stride ?? 1000);
}

export async function resolveLastPageForPaginatedQuery<
	TItem extends Record<string, unknown>
>(args: { createQuery: () => PaginatedQuery<TItem>; numItems: number; order?: 'asc' | 'desc' }) {
	const pageSize = Number.isFinite(args.numItems) && args.numItems > 0 ? args.numItems : 10;
	const totalCount = await countPaginatedQuery({
		createQuery: args.createQuery,
		order: args.order,
		stride: Math.max(pageSize, 1000)
	});
	if (totalCount <= 0) {
		return { page: 1, cursor: null as string | null };
	}

	const page = Math.max(1, Math.ceil(totalCount / pageSize));
	const targetOffset = (page - 1) * pageSize;
	if (targetOffset <= 0) {
		return { page: 1, cursor: null as string | null };
	}

	const query = args.createQuery();
	const ordered = args.order && query.order ? query.order(args.order) : query;
	const stride = Math.max(pageSize, 1000);
	let cursor: string | null = null;
	let walked = 0;

	while (walked + stride <= targetOffset) {
		const result = await ordered.paginate({
			cursor,
			numItems: stride
		});
		if (result.isDone || !result.continueCursor) {
			return { page, cursor };
		}
		cursor = result.continueCursor;
		walked += stride;
	}

	const remaining = targetOffset - walked;
	if (remaining > 0) {
		const result = await ordered.paginate({
			cursor,
			numItems: remaining
		});
		cursor = result.continueCursor ?? cursor;
	}

	return { page, cursor };
}

/**
 * Parse a `min..max` string and test whether `value` falls within the range (inclusive).
 * Either bound may be omitted: `..100` means <= 100, `50..` means >= 50.
 * Returns `true` when the value is in range or the filter string is empty/invalid.
 */
export function matchesNumberRange(value: unknown, rangeStr: string | undefined): boolean {
	if (!rangeStr || !rangeStr.includes('..')) return true;
	const [minStr, maxStr] = rangeStr.split('..');
	const min = minStr !== '' ? Number(minStr) : null;
	const max = maxStr !== '' ? Number(maxStr) : null;
	if (min !== null && !Number.isFinite(min)) return true;
	if (max !== null && !Number.isFinite(max)) return true;

	const num = typeof value === 'number' ? value : Number(value);
	if (!Number.isFinite(num)) return true;

	if (min !== null && num < min) return false;
	if (max !== null && num > max) return false;
	return true;
}
