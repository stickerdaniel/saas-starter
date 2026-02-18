import {
	getCoreRowModel,
	getFacetedRowModel,
	getFacetedUniqueValues,
	getFilteredRowModel,
	getPaginationRowModel,
	getSortedRowModel,
	type ColumnFiltersState,
	type PaginationState,
	type RowData,
	type RowSelectionState,
	type SortingState,
	type Updater,
	type VisibilityState
} from '@tanstack/table-core';
import { createSvelteTable } from '$lib/components/ui/data-table/data-table.svelte.js';
import type { BaseTableConfig } from './types';

function applyUpdater<T>(current: T, updater: Updater<T>): T {
	if (typeof updater === 'function') {
		return (updater as (value: T) => T)(current);
	}
	return updater;
}

export type CreateBaseTanStackTableOptions<TData extends RowData> = BaseTableConfig<TData> & {
	getColumns?: () => any[];
	getData: () => TData[];
	getIsLoading?: () => boolean;
	initialSorting?: SortingState;
	initialPagination?: PaginationState;
	initialColumnFilters?: ColumnFiltersState;
	initialRowSelection?: RowSelectionState;
	initialColumnVisibility?: VisibilityState;
	enableRowSelection?: boolean;
};

export function createBaseTanStackTable<TData extends RowData>(
	options: CreateBaseTanStackTableOptions<TData>
) {
	let sorting = $state<SortingState>(options.initialSorting ?? []);
	let pagination = $state<PaginationState>(
		options.initialPagination ?? { pageIndex: 0, pageSize: 10 }
	);
	let columnFilters = $state<ColumnFiltersState>(options.initialColumnFilters ?? []);
	let rowSelection = $state<RowSelectionState>(options.initialRowSelection ?? {});
	let columnVisibility = $state<VisibilityState>(options.initialColumnVisibility ?? {});

	const table = createSvelteTable<TData>({
		get data() {
			return options.getData();
		},
		get columns() {
			return options.getColumns ? options.getColumns() : options.columns;
		},
		meta: {
			get isLoading() {
				return options.getIsLoading ? options.getIsLoading() : false;
			}
		},
		state: {
			get pagination() {
				return pagination;
			},
			get sorting() {
				return sorting;
			},
			get columnVisibility() {
				return columnVisibility;
			},
			get rowSelection() {
				return rowSelection;
			},
			get columnFilters() {
				return columnFilters;
			}
		},
		getRowId: options.getRowId,
		enableRowSelection: options.enableRowSelection ?? true,
		getCoreRowModel: getCoreRowModel(),
		getPaginationRowModel: getPaginationRowModel(),
		getSortedRowModel: getSortedRowModel(),
		getFacetedRowModel: getFacetedRowModel(),
		getFacetedUniqueValues: getFacetedUniqueValues(),
		getFilteredRowModel: getFilteredRowModel(),
		onPaginationChange: (updater) => {
			pagination = applyUpdater(pagination, updater);
		},
		onSortingChange: (updater) => {
			sorting = applyUpdater(sorting, updater);
		},
		onColumnFiltersChange: (updater) => {
			columnFilters = applyUpdater(columnFilters, updater);
		},
		onColumnVisibilityChange: (updater) => {
			columnVisibility = applyUpdater(columnVisibility, updater);
		},
		onRowSelectionChange: (updater) => {
			rowSelection = applyUpdater(rowSelection, updater);
		}
	});

	return {
		table,
		get sorting() {
			return sorting;
		},
		get pagination() {
			return pagination;
		},
		get columnFilters() {
			return columnFilters;
		},
		get rowSelection() {
			return rowSelection;
		},
		get columnVisibility() {
			return columnVisibility;
		},
		get selectedCount() {
			return Object.keys(rowSelection).length;
		}
	};
}
