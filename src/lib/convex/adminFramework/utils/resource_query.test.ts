import { describe, expect, it } from 'vitest';
import { filterTrashed, resolveLastPage, runResourceListQuery } from './resource_query';

describe('admin resource query utils', () => {
	it('filters soft-deleted records by trashed mode', () => {
		const items = [
			{ id: 'a', deletedAt: undefined },
			{ id: 'b', deletedAt: 10 }
		];

		expect(filterTrashed(items, 'without').map((item) => item.id)).toEqual(['a']);
		expect(filterTrashed(items, 'only').map((item) => item.id)).toEqual(['b']);
		expect(filterTrashed(items, 'with').map((item) => item.id)).toEqual(['a', 'b']);
	});

	it('runs search/filter/sort and cursor pagination', () => {
		const items = [
			{ id: '1', name: 'Alpha', status: 'active', deletedAt: undefined },
			{ id: '2', name: 'Beta', status: 'active', deletedAt: undefined },
			{ id: '3', name: 'Gamma', status: 'archived', deletedAt: undefined }
		];

		const result = runResourceListQuery({
			items,
			numItems: 1,
			cursor: '1',
			search: 'a',
			sortBy: { field: 'name', direction: 'asc' },
			sortMap: { name: (item) => item.name },
			searchableValues: (item) => [item.name],
			applyFilters: (item) => item.status === 'active'
		});

		expect(result.items.map((item) => item.id)).toEqual(['2']);
		expect(result.continueCursor).toBe(null);
		expect(result.isDone).toBe(true);
		expect(result.totalCount).toBe(2);
	});

	it('resolves last page cursor snapshot', () => {
		expect(resolveLastPage({ totalCount: 0, numItems: 10 })).toEqual({ page: 1, cursor: null });
		expect(resolveLastPage({ totalCount: 21, numItems: 10 })).toEqual({ page: 3, cursor: '20' });
	});
});
