import { describe, expect, it } from 'vitest';
import {
	buildNextPageCursors,
	buildTrimmedCache,
	getExplicitPageSizeFromSearch,
	getCanNextPage,
	getDisplayPageCount,
	getEffectiveDisplayPageCount,
	getDisplayTotalCount,
	getNextPrefetchCandidate,
	getPreviousPrefetchCandidate,
	getSkeletonRowCount,
	shouldShowEmptyPlaceholderWhileLoading,
	isAtLastPage,
	isPageIndexOutOfRange,
	hasCountIdentityChanged,
	hasPageBoundaryChanged,
	hasQueryIdentityChanged,
	hasTotalCountChanged,
	normalizePageSizeOption,
	resolveExplicitPageSizeDuringUrlSync,
	resolveEffectivePageSizeParam,
	serializeCountIdentity
} from './create-convex-cursor-table.svelte';
import type { CursorListResult } from './contract';

function page(
	items: string[],
	continueCursor: string | null,
	isDone: boolean
): CursorListResult<string> {
	return { items, continueCursor, isDone } as CursorListResult<string>;
}

describe('convex cursor table helpers', () => {
	it('extracts explicit page_size only when present in search params', () => {
		expect(getExplicitPageSizeFromSearch('?page=2&page_size=20')).toBe('20');
		expect(getExplicitPageSizeFromSearch('?page=2')).toBeUndefined();
		expect(getExplicitPageSizeFromSearch('')).toBeUndefined();
	});

	it('prefers reactive URL state when explicit search param is present', () => {
		expect(resolveExplicitPageSizeDuringUrlSync('10', '20')).toBe('20');
		expect(resolveExplicitPageSizeDuringUrlSync(undefined, '20')).toBeUndefined();
	});

	it('normalizes page size options safely', () => {
		expect(normalizePageSizeOption('20', ['10', '20', '50'], '10')).toBe('20');
		expect(normalizePageSizeOption('999', ['10', '20', '50'], '10')).toBe('10');
		expect(normalizePageSizeOption(undefined, ['10', '20', '50'], '10')).toBe('10');
		expect(normalizePageSizeOption(undefined, ['10', '20', '50'], '999')).toBe('10');
	});

	it('resolves effective page size with URL-first precedence', () => {
		expect(
			resolveEffectivePageSizeParam({
				explicitUrlPageSize: '10',
				persistedPageSize: '50',
				urlStatePageSize: '20',
				pageSizeOptions: ['10', '20', '50'],
				defaultPageSize: '10'
			})
		).toBe('10');

		expect(
			resolveEffectivePageSizeParam({
				persistedPageSize: '50',
				urlStatePageSize: '20',
				pageSizeOptions: ['10', '20', '50'],
				defaultPageSize: '10'
			})
		).toBe('50');

		expect(
			resolveEffectivePageSizeParam({
				persistedPageSize: '999',
				urlStatePageSize: '20',
				pageSizeOptions: ['10', '20', '50'],
				defaultPageSize: '10'
			})
		).toBe('10');

		expect(
			resolveEffectivePageSizeParam({
				explicitUrlPageSize: '999',
				persistedPageSize: '50',
				urlStatePageSize: '20',
				pageSizeOptions: ['10', '20', '50'],
				defaultPageSize: '10'
			})
		).toBe('10');
	});

	it('detects query identity changes for reset triggers', () => {
		const base = {
			search: '',
			pageSize: 10,
			filters: { role: 'all', status: 'all' },
			sortBy: undefined
		};

		expect(hasQueryIdentityChanged(base, { ...base, search: 'alice' })).toBe(true);
		expect(hasQueryIdentityChanged(base, { ...base, pageSize: 20 })).toBe(true);
		expect(
			hasQueryIdentityChanged(base, { ...base, filters: { role: 'admin', status: 'all' } })
		).toBe(true);
		expect(
			hasQueryIdentityChanged(base, { ...base, sortBy: { field: 'email', direction: 'asc' } })
		).toBe(true);
		expect(hasQueryIdentityChanged(base, { ...base })).toBe(false);
	});

	it('keys count identity by search + filters only', () => {
		const base = {
			search: '',
			filters: { role: 'all', status: 'all' }
		};

		expect(hasCountIdentityChanged(base, { ...base, search: 'alice' })).toBe(true);
		expect(
			hasCountIdentityChanged(base, {
				...base,
				filters: { role: 'admin', status: 'all' }
			})
		).toBe(true);
		expect(serializeCountIdentity(base)).toBe(
			serializeCountIdentity({ search: '', filters: { status: 'all', role: 'all' } })
		);

		const queryWithSortAsc = {
			search: base.search,
			pageSize: 10,
			filters: base.filters,
			sortBy: { field: 'email', direction: 'asc' as const }
		};
		const queryWithSortDesc = {
			...queryWithSortAsc,
			sortBy: { field: 'email', direction: 'desc' as const }
		};
		expect(
			serializeCountIdentity({
				search: queryWithSortAsc.search,
				filters: queryWithSortAsc.filters
			})
		).toBe(
			serializeCountIdentity({
				search: queryWithSortDesc.search,
				filters: queryWithSortDesc.filters
			})
		);
	});

	it('builds next-page cursor stack correctly', () => {
		expect(buildNextPageCursors([null], 1, 'cursor-1')).toEqual([null, 'cursor-1']);
		expect(buildNextPageCursors([null, 'cursor-1'], 2, 'cursor-2')).toEqual([
			null,
			'cursor-1',
			'cursor-2'
		]);
	});

	it('derives next/previous prefetch candidates', () => {
		expect(
			getNextPrefetchCandidate({
				pageIndex: 0,
				currentPage: page(['a'], 'cursor-1', false),
				cache: {}
			})
		).toEqual({ index: 1, cursor: 'cursor-1' });

		expect(
			getNextPrefetchCandidate({
				pageIndex: 0,
				currentPage: page(['a'], null, true),
				cache: {}
			})
		).toBeUndefined();

		expect(
			getPreviousPrefetchCandidate({
				pageIndex: 2,
				pageCursors: [null, 'cursor-1', 'cursor-2'],
				cache: {}
			})
		).toEqual({ index: 1, cursor: 'cursor-1' });

		expect(
			getPreviousPrefetchCandidate({
				pageIndex: 1,
				pageCursors: [null, 'cursor-1'],
				cache: { 0: page(['cached'], 'cursor-1', false) }
			})
		).toBeUndefined();
	});

	it('trims page cache to nearest pages when cache fills up', () => {
		const cache = {
			0: page(['0'], '1', false),
			1: page(['1'], '2', false),
			2: page(['2'], '3', false),
			3: page(['3'], '4', false),
			4: page(['4'], null, true)
		};

		const trimmed = buildTrimmedCache(cache, 2, 3);
		expect(Object.keys(trimmed).sort()).toEqual(['1', '2', '3']);
	});

	it('only treats boundary updates as structural when same page/cursor shape shifts', () => {
		const base = {
			pageIndex: 2,
			cursor: 'cursor-2',
			continueCursor: 'cursor-3',
			isDone: false,
			itemCount: 10
		};

		expect(hasPageBoundaryChanged(base, { ...base, continueCursor: 'cursor-4' })).toBe(true);
		expect(hasPageBoundaryChanged(base, { ...base, itemCount: 9 })).toBe(true);
		expect(hasPageBoundaryChanged(base, { ...base, isDone: true })).toBe(true);
		expect(hasPageBoundaryChanged(base, { ...base, pageIndex: 3 })).toBe(false);
		expect(hasPageBoundaryChanged(base, { ...base, cursor: 'cursor-3' })).toBe(false);
		expect(hasPageBoundaryChanged(base, { ...base })).toBe(false);
	});

	it('detects total count change only when both values are known', () => {
		expect(hasTotalCountChanged(undefined, 10)).toBe(false);
		expect(hasTotalCountChanged(10, undefined)).toBe(false);
		expect(hasTotalCountChanged(10, 10)).toBe(false);
		expect(hasTotalCountChanged(10, 11)).toBe(true);
	});

	it('calculates display totals and pages from live or cached count', () => {
		expect(
			getDisplayTotalCount({
				liveTotalCount: 44,
				hasLoadedCount: true,
				cachedTotalCount: 12
			})
		).toBe(44);
		expect(
			getDisplayTotalCount({
				liveTotalCount: 44,
				hasLoadedCount: false,
				cachedTotalCount: 12
			})
		).toBe(12);
		expect(
			getDisplayTotalCount({
				liveTotalCount: 44,
				hasLoadedCount: false,
				cachedTotalCount: undefined
			})
		).toBe(0);

		expect(getDisplayPageCount(0, 10)).toBe(1);
		expect(getDisplayPageCount(21, 10)).toBe(3);
		expect(
			getEffectiveDisplayPageCount({
				displayPageCountFromCount: 1,
				pageIndex: 0,
				canNextPage: true
			})
		).toBe(2);
		expect(
			getEffectiveDisplayPageCount({
				displayPageCountFromCount: 5,
				pageIndex: 0,
				canNextPage: false
			})
		).toBe(5);
	});

	it('calculates skeleton row count from known remaining rows', () => {
		expect(
			getSkeletonRowCount({
				totalCount: 23,
				pageIndex: 2,
				pageSize: 10
			})
		).toBe(3);
		expect(
			getSkeletonRowCount({
				totalCount: 15,
				pageIndex: 2,
				pageSize: 10
			})
		).toBe(0);
		expect(
			getSkeletonRowCount({
				totalCount: undefined,
				pageIndex: 0,
				pageSize: 10
			})
		).toBe(10);
	});

	it('shows empty placeholder while loading when cached count is zero', () => {
		expect(
			shouldShowEmptyPlaceholderWhileLoading({
				isLoading: true,
				hasLoadedCount: false,
				cachedTotalCount: 0
			})
		).toBe(true);
		expect(
			shouldShowEmptyPlaceholderWhileLoading({
				isLoading: true,
				hasLoadedCount: false,
				cachedTotalCount: 3
			})
		).toBe(false);
		expect(
			shouldShowEmptyPlaceholderWhileLoading({
				isLoading: true,
				hasLoadedCount: true,
				cachedTotalCount: 0
			})
		).toBe(false);
		expect(
			shouldShowEmptyPlaceholderWhileLoading({
				isLoading: false,
				hasLoadedCount: false,
				cachedTotalCount: 0
			})
		).toBe(false);
	});

	it('detects out-of-range page indexes after count is known', () => {
		expect(
			isPageIndexOutOfRange({
				hasLoadedCount: false,
				pageIndex: 2,
				pageCount: 1
			})
		).toBe(false);

		expect(
			isPageIndexOutOfRange({
				hasLoadedCount: true,
				pageIndex: 1,
				pageCount: 1
			})
		).toBe(true);

		expect(
			isPageIndexOutOfRange({
				hasLoadedCount: true,
				pageIndex: 0,
				pageCount: 1
			})
		).toBe(false);
	});

	it('only treats done pages as terminal when already on last page', () => {
		expect(
			isAtLastPage({
				pageIndex: 1,
				pageCount: 2,
				currentPageIsDone: true
			})
		).toBe(true);

		expect(
			isAtLastPage({
				pageIndex: 2,
				pageCount: 2,
				currentPageIsDone: true
			})
		).toBe(false);

		expect(
			isAtLastPage({
				pageIndex: 1,
				pageCount: 2,
				currentPageIsDone: false
			})
		).toBe(false);
	});

	it('disables next page when loaded count says we are already at last page', () => {
		expect(
			getCanNextPage({
				isJumpingToLastPage: false,
				currentPage: { isDone: false, continueCursor: 'cursor-1' },
				hasLoadedCount: true,
				pageIndex: 0,
				pageCount: 1
			})
		).toBe(false);

		expect(
			getCanNextPage({
				isJumpingToLastPage: false,
				currentPage: { isDone: false, continueCursor: 'cursor-1' },
				hasLoadedCount: false,
				pageIndex: 0,
				pageCount: 1
			})
		).toBe(true);
	});
});
