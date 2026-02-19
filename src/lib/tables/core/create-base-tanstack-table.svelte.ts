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
import { PersistedState } from 'runed';
import { createSvelteTable } from '$lib/components/ui/data-table/data-table.svelte.js';
import type { BaseTableConfig } from './types';

function applyUpdater<T>(current: T, updater: Updater<T>): T {
	if (typeof updater === 'function') {
		return (updater as (value: T) => T)(current);
	}
	return updater;
}

export function normalizeBaseTablePageSize(args: {
	value: number;
	pageSizeOptions?: readonly number[];
	fallback: number;
}) {
	const normalizedValue =
		Number.isFinite(args.value) && args.value > 0 ? Math.trunc(args.value) : NaN;
	const normalizedFallback =
		Number.isFinite(args.fallback) && args.fallback > 0 ? Math.trunc(args.fallback) : 10;
	const options = (args.pageSizeOptions ?? [])
		.filter((option) => Number.isFinite(option) && option > 0)
		.map((option) => Math.trunc(option));

	if (options.length === 0) {
		return Number.isFinite(normalizedValue) ? normalizedValue : normalizedFallback;
	}

	const fallbackFromOptions = options.includes(normalizedFallback)
		? normalizedFallback
		: options[0];
	if (Number.isFinite(normalizedValue) && options.includes(normalizedValue)) {
		return normalizedValue;
	}
	return fallbackFromOptions;
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
	pageSizeStorageKey?: string;
	pageSizeOptions?: readonly number[];
};

export function createBaseTanStackTable<TData extends RowData>(
	options: CreateBaseTanStackTableOptions<TData>
) {
	let sorting = $state<SortingState>(options.initialSorting ?? []);
	const initialPagination = options.initialPagination ?? { pageIndex: 0, pageSize: 10 };
	const fallbackPageSize = normalizeBaseTablePageSize({
		value: initialPagination.pageSize,
		pageSizeOptions: options.pageSizeOptions,
		fallback: 10
	});
	const pageSizePreference = options.pageSizeStorageKey
		? new PersistedState<number>(
				`base-table:page-size:${options.pageSizeStorageKey}`,
				fallbackPageSize
			)
		: undefined;
	const initialPageSize = normalizeBaseTablePageSize({
		value: pageSizePreference ? pageSizePreference.current : fallbackPageSize,
		pageSizeOptions: options.pageSizeOptions,
		fallback: fallbackPageSize
	});
	if (pageSizePreference && pageSizePreference.current !== initialPageSize) {
		pageSizePreference.current = initialPageSize;
	}
	let pagination = $state<PaginationState>({ ...initialPagination, pageSize: initialPageSize });
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
			const next = applyUpdater(pagination, updater);
			const normalizedPageSize = normalizeBaseTablePageSize({
				value: next.pageSize,
				pageSizeOptions: options.pageSizeOptions,
				fallback: fallbackPageSize
			});
			pagination = { ...next, pageSize: normalizedPageSize };
			if (pageSizePreference && pageSizePreference.current !== normalizedPageSize) {
				pageSizePreference.current = normalizedPageSize;
			}
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
