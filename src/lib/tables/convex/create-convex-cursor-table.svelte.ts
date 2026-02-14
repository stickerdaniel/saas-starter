import { Debounced, watch } from 'runed';
import { useSearchParams } from 'runed/kit';
import { useConvexClient, useQuery } from 'convex-svelte';
import { untrack } from 'svelte';
import type { FunctionArgs, FunctionReference, FunctionReturnType } from 'convex/server';
import type { GenericSchema } from 'valibot';
import type { CursorListResult, TableSortBy, TableUrlState } from './contract';
import {
	parseCursorParam,
	parsePageIndex,
	parsePageSize,
	parseSortParam,
	serializeCursorParam,
	serializeSortParam
} from './url';

type AnyQuery = FunctionReference<'query'>;

/** Public state returned by `createConvexCursorTable`. */
export type ConvexCursorTableState<TItem, TSortField extends string, TFilterKeys extends string> = {
	readonly urlState: TableUrlState<TFilterKeys>;
	readonly rows: TItem[];
	readonly isLoading: boolean;
	readonly totalCount: number;
	readonly hasLoadedCount: boolean;
	readonly pageCount: number;
	readonly pageIndex: number;
	readonly pageSize: number;
	readonly sortBy: TableSortBy<TSortField> | undefined;
	readonly filters: Record<TFilterKeys, string>;
	readonly currentUrlState: TableUrlState<TFilterKeys>;
	readonly canNextPage: boolean;
	readonly canPreviousPage: boolean;
	readonly isJumpingToLastPage: boolean;
	setSearch: (value: string) => void;
	setFilter: (key: TFilterKeys, value: string) => void;
	setSort: (nextSort: TableSortBy<TSortField> | undefined) => void;
	setPageSize: (nextPageSize: number) => void;
	goFirst: () => void;
	goLast: () => Promise<void>;
	goNext: () => void;
	goPrevious: () => Promise<void>;
};

type QueryIdentity<TFilterKeys extends string, TSortField extends string> = {
	search: string;
	pageSize: number;
	filters: Record<TFilterKeys, string>;
	sortBy: TableSortBy<TSortField> | undefined;
};

export function serializeQueryIdentity<TFilterKeys extends string, TSortField extends string>(
	identity: QueryIdentity<TFilterKeys, TSortField>
) {
	const filterEntries = Object.entries(identity.filters).sort(([a], [b]) => a.localeCompare(b));
	return JSON.stringify({
		search: identity.search,
		pageSize: identity.pageSize,
		sortBy: identity.sortBy ?? null,
		filters: filterEntries
	});
}

export function hasQueryIdentityChanged<TFilterKeys extends string, TSortField extends string>(
	previous: QueryIdentity<TFilterKeys, TSortField>,
	next: QueryIdentity<TFilterKeys, TSortField>
) {
	return serializeQueryIdentity(previous) !== serializeQueryIdentity(next);
}

export function buildNextPageCursors(
	existing: (string | null)[],
	nextIndex: number,
	nextCursor: string
): (string | null)[] {
	const next = existing.slice(0, nextIndex);
	next[nextIndex] = nextCursor;
	return next;
}

export function buildTrimmedCache<TItem>(
	cache: Record<number, CursorListResult<TItem>>,
	currentPageIndex: number,
	maxCachedPages: number
) {
	const entries = Object.entries(cache).map(([index, value]) => ({
		index: Number.parseInt(index, 10),
		value
	}));
	if (entries.length <= maxCachedPages) return cache;

	entries.sort((a, b) => {
		const distanceA = Math.abs(a.index - currentPageIndex);
		const distanceB = Math.abs(b.index - currentPageIndex);
		return distanceA - distanceB;
	});

	const trimmedEntries = entries.slice(0, maxCachedPages);
	const trimmed: Record<number, CursorListResult<TItem>> = {};
	for (const entry of trimmedEntries) {
		trimmed[entry.index] = entry.value;
	}
	return trimmed;
}

export function getNextPrefetchCandidate<TItem>(args: {
	pageIndex: number;
	currentPage: CursorListResult<TItem> | undefined;
	cache: Record<number, CursorListResult<TItem>>;
}) {
	if (!args.currentPage || args.currentPage.isDone || !args.currentPage.continueCursor) {
		return undefined;
	}

	const index = args.pageIndex + 1;
	if (args.cache[index]) return undefined;

	return {
		index,
		cursor: args.currentPage.continueCursor
	};
}

export function getPreviousPrefetchCandidate<TItem>(args: {
	pageIndex: number;
	pageCursors: (string | null)[];
	cache: Record<number, CursorListResult<TItem>>;
}) {
	const index = args.pageIndex - 1;
	if (index < 0 || args.cache[index]) return undefined;
	const cursor = args.pageCursors[index];
	if (cursor === undefined) return undefined;

	return {
		index,
		cursor
	};
}

type PageBoundarySnapshot = {
	pageIndex: number;
	cursor: string | null;
	continueCursor: string | null;
	isDone: boolean;
	itemCount: number;
};

export function hasTotalCountChanged(previous: number | undefined, next: number | undefined) {
	if (previous === undefined || next === undefined) return false;
	return previous !== next;
}

export function hasPageBoundaryChanged(
	previous: PageBoundarySnapshot | undefined,
	next: PageBoundarySnapshot
) {
	if (!previous) return false;
	if (previous.pageIndex !== next.pageIndex) return false;
	if (previous.cursor !== next.cursor) return false;
	return (
		previous.continueCursor !== next.continueCursor ||
		previous.isDone !== next.isDone ||
		previous.itemCount !== next.itemCount
	);
}

type ListContext<
	TFilterKeys extends string,
	TSortField extends string,
	TUrlState extends TableUrlState<TFilterKeys>
> = {
	cursor: string | null;
	pageIndex: number;
	pageSize: number;
	search: string | undefined;
	filters: Record<TFilterKeys, string>;
	sortBy: TableSortBy<TSortField> | undefined;
	urlState: TUrlState;
};

type CountContext<
	TFilterKeys extends string,
	TSortField extends string,
	TUrlState extends TableUrlState<TFilterKeys>
> = Omit<ListContext<TFilterKeys, TSortField, TUrlState>, 'cursor' | 'pageIndex'>;

type LastPageResolution = {
	page: number;
	cursor: string | null;
};

export type CreateConvexCursorTableOptions<
	TItem,
	TFilterKeys extends string,
	TSortField extends string,
	TListQuery extends AnyQuery,
	TCountQuery extends AnyQuery,
	TUrlState extends TableUrlState<TFilterKeys>
> = {
	listQuery: TListQuery;
	countQuery: TCountQuery;
	urlSchema: GenericSchema<unknown, TUrlState>;
	defaultFilters: Record<TFilterKeys, string>;
	pageSizeOptions: readonly string[];
	defaultPageSize: string;
	sortFields: readonly TSortField[];
	debounceMs?: number;
	maxCachedPages?: number;
	buildListArgs: (
		context: ListContext<TFilterKeys, TSortField, TUrlState>
	) => FunctionArgs<TListQuery>;
	buildCountArgs: (
		context: CountContext<TFilterKeys, TSortField, TUrlState>
	) => FunctionArgs<TCountQuery>;
	resolveLastPage: (
		context: CountContext<TFilterKeys, TSortField, TUrlState>
	) => Promise<LastPageResolution | null>;
	toListResult: (result: FunctionReturnType<TListQuery>) => CursorListResult<TItem>;
	toCount: (result: FunctionReturnType<TCountQuery>) => number;
};

/**
 * Create a reactive, cursor-paginated table state bound to Convex queries.
 *
 * Manages URL-synced pagination, search, filtering, sorting, and page caching.
 * All query identity changes (search, filters, sort, page size) automatically
 * reset pagination to page 1. Cursor state is persisted in URL params via
 * Runed `useSearchParams` so deep links and browser back/forward work.
 *
 * @param options.listQuery - Convex query reference for fetching paginated rows
 * @param options.countQuery - Convex query reference for total count
 * @param options.urlSchema - Valibot schema defining the URL state shape
 * @param options.defaultFilters - Default values for filter URL params (omitted from URL when active)
 * @param options.pageSizeOptions - Allowed page size values (as strings)
 * @param options.defaultPageSize - Initial page size (as string)
 * @param options.sortFields - Valid sort field names for validation
 * @param options.buildListArgs - Map current context to list query args
 * @param options.buildCountArgs - Map current context to count query args
 * @param options.resolveLastPage - Server-side resolver for jump-to-last-page
 * @param options.toListResult - Normalize list query response to `CursorListResult`
 * @param options.toCount - Extract count number from count query response
 * @param options.debounceMs - Search debounce delay (default: 300ms)
 * @param options.maxCachedPages - Max pages kept in memory cache (default: 5)
 */
export function createConvexCursorTable<
	TItem,
	TFilterKeys extends string,
	TSortField extends string,
	TListQuery extends AnyQuery,
	TCountQuery extends AnyQuery,
	TUrlState extends TableUrlState<TFilterKeys>
>(
	options: CreateConvexCursorTableOptions<
		TItem,
		TFilterKeys,
		TSortField,
		TListQuery,
		TCountQuery,
		TUrlState
	>
) {
	const client = useConvexClient();
	const urlState = useSearchParams(options.urlSchema, {
		pushHistory: true,
		noScroll: true
	}) as TUrlState;

	const debounceMs = options.debounceMs ?? 300;
	const maxCachedPages = options.maxCachedPages ?? 8;
	const fallbackPageSize = Number.parseInt(options.defaultPageSize, 10);

	const debouncedSearch = new Debounced(() => urlState.search.trim(), debounceMs);
	const pageIndex = $derived(parsePageIndex(urlState.page));
	const pageSize = $derived(parsePageSize(urlState.page_size, fallbackPageSize));
	const sortBy = $derived(
		parseSortParam(urlState.sort, options.sortFields) as TableSortBy<TSortField> | undefined
	);
	const filters = $derived.by(() => {
		const next = {} as Record<TFilterKeys, string>;
		for (const key of Object.keys(options.defaultFilters) as TFilterKeys[]) {
			next[key] = urlState[key];
		}
		return next;
	});

	let pageCursors = $state<(string | null)[]>([null]);
	let pageCache = $state<Record<number, CursorListResult<TItem>>>({});
	let isJumpingToLastPage = $state(false);
	let isResolvingPreviousPage = $state(false);

	const currentCursor = $derived.by(() => {
		if (pageIndex === 0) return null;
		return pageCursors[pageIndex] ?? parseCursorParam(urlState.cursor);
	});

	function getListContext(cursor: string | null, nextPageIndex: number) {
		return {
			cursor,
			pageIndex: nextPageIndex,
			pageSize,
			search: debouncedSearch.current || undefined,
			filters,
			sortBy,
			urlState
		} satisfies ListContext<TFilterKeys, TSortField, TUrlState>;
	}

	function getCountContext() {
		return {
			pageSize,
			search: debouncedSearch.current || undefined,
			filters,
			sortBy,
			urlState
		} satisfies CountContext<TFilterKeys, TSortField, TUrlState>;
	}

	function getQueryIdentity(): QueryIdentity<TFilterKeys, TSortField> {
		return {
			search: debouncedSearch.current,
			pageSize,
			filters,
			sortBy
		};
	}

	function isIdentitySnapshotCurrent(serializedIdentity: string) {
		return serializeQueryIdentity(getQueryIdentity()) === serializedIdentity;
	}

	async function hydrateCursorPathToPage(
		targetPageIndex: number,
		identitySnapshot: string
	): Promise<{
		cursors: (string | null)[];
		cache: Record<number, CursorListResult<TItem>>;
	} | null> {
		if (targetPageIndex <= 0) {
			return {
				cursors: [...untrack(() => pageCursors)],
				cache: { ...untrack(() => pageCache) }
			};
		}

		let nextCursors = [...untrack(() => pageCursors)];
		const nextCache = {
			...untrack(() => pageCache)
		};
		let walkCursor: string | null = null;

		for (let index = 0; index < targetPageIndex; index++) {
			if (!isIdentitySnapshotCurrent(identitySnapshot)) return null;

			let page = nextCache[index];
			if (!page) {
				const fetched = await client.query(
					options.listQuery,
					options.buildListArgs(getListContext(walkCursor, index))
				);
				if (!isIdentitySnapshotCurrent(identitySnapshot)) return null;
				page = options.toListResult(fetched);
				nextCache[index] = page;
			}

			if (!page.continueCursor) {
				return {
					cursors: nextCursors,
					cache: nextCache
				};
			}

			nextCursors = buildNextPageCursors(nextCursors, index + 1, page.continueCursor);
			walkCursor = page.continueCursor;
		}

		return {
			cursors: nextCursors,
			cache: nextCache
		};
	}

	const listQuery = useQuery(options.listQuery, () =>
		options.buildListArgs(getListContext(currentCursor, pageIndex))
	);
	const countQuery = useQuery(options.countQuery, () => options.buildCountArgs(getCountContext()));

	const currentPageData = $derived.by(() => {
		const cached = pageCache[pageIndex];
		if (cached) return cached;
		if (!listQuery.data) return undefined;
		return options.toListResult(listQuery.data);
	});

	const rows = $derived(currentPageData?.items ?? []);
	const totalCount = $derived(countQuery.data === undefined ? 0 : options.toCount(countQuery.data));
	const hasLoadedCount = $derived(countQuery.data !== undefined);
	const pageCount = $derived(Math.max(1, Math.ceil(totalCount / pageSize)));
	const isLoading = $derived(
		isJumpingToLastPage ||
			isResolvingPreviousPage ||
			(currentPageData === undefined && listQuery.isLoading)
	);

	function cachePage(index: number, data: CursorListResult<TItem> | undefined) {
		if (!data) return;
		const next = {
			...untrack(() => pageCache),
			[index]: data
		};
		pageCache = buildTrimmedCache(next, pageIndex, maxCachedPages);
	}

	function cacheCurrentPage() {
		cachePage(pageIndex, currentPageData);
	}

	function keepOnlyCurrentPageCache() {
		const liveCurrent = listQuery.data ? options.toListResult(listQuery.data) : currentPageData;
		const nextCache: Record<number, CursorListResult<TItem>> = {};
		if (liveCurrent) {
			nextCache[pageIndex] = liveCurrent;
		}
		pageCache = nextCache;

		const nextCursors: (string | null)[] = [null];
		if (pageIndex > 0) {
			const cursor = currentCursor ?? parseCursorParam(urlState.cursor);
			if (cursor) {
				nextCursors[pageIndex] = cursor;
			}
		}
		pageCursors = nextCursors;
	}

	function resetPagination() {
		if (urlState.page !== '1') {
			urlState.page = '1';
		}
		if (urlState.cursor !== '') {
			urlState.cursor = '';
		}
		pageCursors = [null];
		pageCache = {};
	}

	$effect(() => {
		if (!listQuery.data) return;
		cachePage(pageIndex, options.toListResult(listQuery.data));
	});

	$effect(() => {
		if (pageIndex === 0) return;
		if (pageCursors[pageIndex]) return;

		const decodedCursor = parseCursorParam(urlState.cursor);
		if (decodedCursor) {
			const next = pageCursors.slice(0, pageIndex + 1);
			next[pageIndex] = decodedCursor;
			pageCursors = next;
			return;
		}

		resetPagination();
	});

	watch(
		() =>
			serializeQueryIdentity({
				search: debouncedSearch.current,
				pageSize,
				filters,
				sortBy
			}),
		(curr, prev) => {
			if (prev !== undefined && curr !== prev) resetPagination();
		},
		{ lazy: true }
	);

	watch(
		() => (countQuery.data === undefined ? undefined : options.toCount(countQuery.data)),
		(curr, prev) => {
			if (curr !== undefined && prev !== undefined && curr !== prev) {
				keepOnlyCurrentPageCache();
			}
		}
	);

	const pageBoundaryKey = $derived.by(() => {
		if (!listQuery.data) return undefined;
		const normalized = options.toListResult(listQuery.data);
		return `${pageIndex}:${currentCursor}:${normalized.continueCursor}:${normalized.isDone}:${normalized.items.length}`;
	});

	watch(
		() => pageBoundaryKey,
		(curr, prev) => {
			if (curr !== undefined && prev !== undefined && curr !== prev) {
				keepOnlyCurrentPageCache();
			}
		}
	);

	const nextPrefetch = $derived.by(() => {
		const candidate = getNextPrefetchCandidate({
			pageIndex,
			currentPage: currentPageData,
			cache: pageCache
		});
		if (!candidate) return undefined;
		return {
			index: candidate.index,
			args: options.buildListArgs(getListContext(candidate.cursor, candidate.index))
		};
	});

	const nextPrefetchQuery = useQuery(options.listQuery, () => nextPrefetch?.args ?? 'skip');

	$effect(() => {
		if (!nextPrefetch || !nextPrefetchQuery.data) return;
		cachePage(nextPrefetch.index, options.toListResult(nextPrefetchQuery.data));
	});

	const previousPrefetch = $derived.by(() => {
		const candidate = getPreviousPrefetchCandidate({
			pageIndex,
			pageCursors,
			cache: pageCache
		});
		if (!candidate) return undefined;
		return {
			index: candidate.index,
			args: options.buildListArgs(getListContext(candidate.cursor, candidate.index))
		};
	});

	const previousPrefetchQuery = useQuery(options.listQuery, () => previousPrefetch?.args ?? 'skip');

	$effect(() => {
		if (!previousPrefetch || !previousPrefetchQuery.data) return;
		cachePage(previousPrefetch.index, options.toListResult(previousPrefetchQuery.data));
	});

	const canPreviousPage = $derived.by(() => {
		if (isJumpingToLastPage || isResolvingPreviousPage) return false;
		return pageIndex > 0;
	});

	const canNextPage = $derived.by(() => {
		if (isJumpingToLastPage) return false;
		const data = currentPageData;
		return !!data && !data.isDone && !!data.continueCursor;
	});

	function setSearch(search: string) {
		urlState.search = search;
	}

	function setFilter<TKey extends TFilterKeys>(key: TKey, value: string) {
		urlState[key] = value as TUrlState[TKey];
		resetPagination();
	}

	function setSort(nextSort: TableSortBy<TSortField> | undefined) {
		urlState.sort = serializeSortParam(nextSort);
		resetPagination();
	}

	function setPageSize(nextPageSize: number) {
		const next = `${nextPageSize}`;
		if (!options.pageSizeOptions.includes(next)) return;
		if (urlState.page_size === next) return;
		urlState.page_size = next;
		resetPagination();
	}

	function goFirst() {
		cacheCurrentPage();
		urlState.page = '1';
		urlState.cursor = '';
	}

	async function goPrevious() {
		if (!canPreviousPage) return;
		cacheCurrentPage();

		const previousIndex = pageIndex - 1;
		let previousCursor = previousIndex === 0 ? null : pageCursors[previousIndex];

		if (previousIndex > 0 && previousCursor === undefined) {
			isResolvingPreviousPage = true;
			try {
				const identitySnapshot = serializeQueryIdentity(getQueryIdentity());
				const hydrated = await hydrateCursorPathToPage(previousIndex, identitySnapshot);
				if (!hydrated || !isIdentitySnapshotCurrent(identitySnapshot)) return;

				pageCursors = hydrated.cursors;
				pageCache = buildTrimmedCache(hydrated.cache, pageIndex, maxCachedPages);
				previousCursor = hydrated.cursors[previousIndex];
			} catch (error) {
				console.error('Failed to navigate to previous page', error);
				return;
			} finally {
				isResolvingPreviousPage = false;
			}
		}

		if (previousIndex > 0 && previousCursor === undefined) return;

		urlState.page = `${previousIndex + 1}`;
		urlState.cursor = serializeCursorParam(previousCursor);
	}

	function goNext() {
		const nextCursor = currentPageData?.continueCursor;
		if (!canNextPage || !nextCursor) return;

		cacheCurrentPage();
		const nextIndex = pageIndex + 1;
		pageCursors = buildNextPageCursors(pageCursors, nextIndex, nextCursor);
		urlState.page = `${nextIndex + 1}`;
		urlState.cursor = serializeCursorParam(nextCursor);
	}

	async function goLast() {
		if (isJumpingToLastPage) return;

		cacheCurrentPage();
		if (currentPageData?.isDone) return;

		isJumpingToLastPage = true;
		const identitySnapshot = serializeQueryIdentity(getQueryIdentity());

		try {
			const resolved = await options.resolveLastPage(getCountContext());
			if (!resolved || !isIdentitySnapshotCurrent(identitySnapshot)) return;

			const resolvedPage = Number.isFinite(resolved.page)
				? Math.max(1, Math.trunc(resolved.page))
				: 1;
			const resolvedCursor = resolved.cursor ?? null;

			if (resolvedPage <= 1) {
				urlState.page = '1';
				urlState.cursor = '';
				pageCursors = [null];
				return;
			}

			const resolvedIndex = resolvedPage - 1;
			const nextCursors = pageCursors.slice(0, resolvedIndex + 1);
			nextCursors[resolvedIndex] = resolvedCursor;
			pageCursors = nextCursors;
			urlState.page = `${resolvedPage}`;
			urlState.cursor = serializeCursorParam(resolvedCursor);
		} catch (error) {
			console.error('Failed to jump to last page', error);
		} finally {
			isJumpingToLastPage = false;
		}
	}

	return {
		get urlState() {
			return urlState;
		},
		get rows() {
			return rows;
		},
		get isLoading() {
			return isLoading;
		},
		get totalCount() {
			return totalCount;
		},
		get hasLoadedCount() {
			return hasLoadedCount;
		},
		get pageCount() {
			return pageCount;
		},
		get pageIndex() {
			return pageIndex;
		},
		get pageSize() {
			return pageSize;
		},
		get sortBy() {
			return sortBy;
		},
		get filters() {
			return filters;
		},
		get currentUrlState() {
			return urlState;
		},
		get canNextPage() {
			return canNextPage;
		},
		get canPreviousPage() {
			return canPreviousPage;
		},
		get isJumpingToLastPage() {
			return isJumpingToLastPage;
		},
		setSearch,
		setFilter,
		setSort,
		setPageSize,
		goFirst,
		goLast,
		goNext,
		goPrevious
	};
}
