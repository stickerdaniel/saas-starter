import { describe, expect, it } from 'vitest';
import {
	buildNextPageCursors,
	buildTrimmedCache,
	getNextPrefetchCandidate,
	getPreviousPrefetchCandidate,
	hasPageBoundaryChanged,
	hasTotalCountChanged,
	hasQueryIdentityChanged
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
});
