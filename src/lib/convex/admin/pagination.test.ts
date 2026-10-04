import { describe, expect, it } from 'vitest';
import { resolveOffsetLastPage, sliceOffsetPage } from './pagination';

describe('sliceOffsetPage', () => {
	const list = [0, 1, 2, 3, 4];

	it('slices the first page and reports the next offset', () => {
		expect(sliceOffsetPage(list, undefined, 2)).toEqual({
			items: [0, 1],
			continueCursor: '2',
			isDone: false
		});
	});

	it('continues from a numeric offset cursor', () => {
		expect(sliceOffsetPage(list, '2', 2)).toEqual({
			items: [2, 3],
			continueCursor: '4',
			isDone: false
		});
	});

	it('marks the last page as done with a null cursor', () => {
		expect(sliceOffsetPage(list, '4', 2)).toEqual({
			items: [4],
			continueCursor: null,
			isDone: true
		});
	});

	it('marks an exactly full last page as done', () => {
		expect(sliceOffsetPage(list, '3', 2)).toEqual({
			items: [3, 4],
			continueCursor: null,
			isDone: true
		});
	});

	it('returns an empty done page when the offset is at or past the end', () => {
		expect(sliceOffsetPage(list, '5', 2)).toEqual({
			items: [],
			continueCursor: null,
			isDone: true
		});
		expect(sliceOffsetPage(list, '50', 2)).toEqual({
			items: [],
			continueCursor: null,
			isDone: true
		});
	});

	it('restarts at 0 for missing, negative or garbage cursors', () => {
		const firstPage = { items: [0, 1], continueCursor: '2', isDone: false };
		expect(sliceOffsetPage(list, '', 2)).toEqual(firstPage);
		expect(sliceOffsetPage(list, '-5', 2)).toEqual(firstPage);
		expect(sliceOffsetPage(list, 'not-a-number', 2)).toEqual(firstPage);
	});

	it('returns an empty done page for empty rows', () => {
		expect(sliceOffsetPage([], undefined, 10)).toEqual({
			items: [],
			continueCursor: null,
			isDone: true
		});
	});
});

describe('resolveOffsetLastPage', () => {
	it('stays on the first page for an empty or single-page result', () => {
		expect(resolveOffsetLastPage(0, 10)).toEqual({ page: 1, cursor: null });
		expect(resolveOffsetLastPage(10, 10)).toEqual({ page: 1, cursor: null });
	});

	it('returns the last page and the offset that fetches it', () => {
		expect(resolveOffsetLastPage(11, 10)).toEqual({ page: 2, cursor: '10' });
		expect(resolveOffsetLastPage(20, 10)).toEqual({ page: 2, cursor: '10' });
		expect(resolveOffsetLastPage(21, 10)).toEqual({ page: 3, cursor: '20' });
		expect(resolveOffsetLastPage(5, 1)).toEqual({ page: 5, cursor: '4' });
	});

	it('falls back to 10 rows for a non-positive or non-finite page size', () => {
		expect(resolveOffsetLastPage(25, 0)).toEqual({ page: 3, cursor: '20' });
		expect(resolveOffsetLastPage(25, -3)).toEqual({ page: 3, cursor: '20' });
		expect(resolveOffsetLastPage(25, Number.NaN)).toEqual({ page: 3, cursor: '20' });
	});

	it('agrees with sliceOffsetPage: its cursor fetches the done page', () => {
		const rows = Array.from({ length: 23 }, (_, index) => index);
		const last = resolveOffsetLastPage(rows.length, 5);
		expect(last).toEqual({ page: 5, cursor: '20' });
		expect(sliceOffsetPage(rows, last.cursor ?? undefined, 5)).toEqual({
			items: [20, 21, 22],
			continueCursor: null,
			isDone: true
		});
	});
});
