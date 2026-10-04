import type { SortingState, Updater } from '@tanstack/table-core';
import type { TableSortBy } from './contract';

type SortableTable<TField extends string> = {
	readonly sortBy: TableSortBy<TField> | undefined;
	setSort: (nextSort: TableSortBy<TField> | undefined) => void;
};

/**
 * Bridge TanStack sorting state and a cursor table's URL sort. `columnToField`
 * maps sortable column ids to sort fields; the table shows the inverse. The
 * first sorted column wins, and an unknown column clears the sort.
 */
export function createCursorSorting<TColumn extends string, TField extends string>(options: {
	table: SortableTable<TField>;
	columnToField: Record<TColumn, TField>;
}) {
	const mappings = Object.entries<TField>(options.columnToField);
	const fieldOf = (columnId: string) => mappings.find(([column]) => column === columnId)?.[1];
	const columnOf = (field: TField) => mappings.find(([, mapped]) => mapped === field)?.[0];

	const sorting = $derived.by<SortingState>(() => {
		const sortBy = options.table.sortBy;
		const columnId = sortBy && columnOf(sortBy.field);
		if (!sortBy || !columnId) return [];
		return [{ id: columnId, desc: sortBy.direction === 'desc' }];
	});

	function onSortingChange(updater: Updater<SortingState>) {
		const nextSorting = typeof updater === 'function' ? updater(sorting) : updater;
		const primarySort = nextSorting[0];
		const field = primarySort && fieldOf(primarySort.id);
		options.table.setSort(
			primarySort && field ? { field, direction: primarySort.desc ? 'desc' : 'asc' } : undefined
		);
	}

	return {
		get sorting() {
			return sorting;
		},
		onSortingChange
	};
}
