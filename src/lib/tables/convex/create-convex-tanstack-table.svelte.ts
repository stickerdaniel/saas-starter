import {
	getCoreRowModel,
	type RowData,
	type RowSelectionState,
	type SortingState,
	type VisibilityState
} from '@tanstack/table-core';
import type { FunctionReference } from 'convex/server';
import { createSvelteTable } from '$lib/components/ui/data-table/data-table.svelte.js';
import {
	createConvexCursorTable,
	type ConvexCursorTableState,
	type CreateConvexCursorTableOptions
} from './create-convex-cursor-table.svelte';
import type { SortFieldMaps } from '$lib/tables/core/types';
import type { TableUrlState } from './contract';

function applyUpdater<T>(current: T, updater: T | ((value: T) => T)): T {
	if (typeof updater === 'function') {
		return (updater as (value: T) => T)(current);
	}
	return updater;
}

type AnyQuery = FunctionReference<'query'>;

export type CreateConvexTanStackTableOptions<
	TItem extends RowData,
	TFilterKeys extends string,
	TSortField extends string,
	TListQuery extends AnyQuery,
	TCountQuery extends AnyQuery,
	TUrlState extends TableUrlState<TFilterKeys>
> = {
	convex: CreateConvexCursorTableOptions<
		TItem,
		TFilterKeys,
		TSortField,
		TListQuery,
		TCountQuery,
		TUrlState
	>;
	columns?: any[];
	getColumns?: () => any[];
	getRowId: (row: TItem) => string;
	sortMaps: SortFieldMaps<TSortField>;
	getData?: (rows: TItem[]) => TItem[];
};

export type CreateConvexTanStackTableFromStateOptions<
	TItem extends RowData,
	TSortField extends string
> = {
	convex: ConvexCursorTableState<TItem, TSortField, string>;
	columns?: any[];
	getColumns?: () => any[];
	getRowId: (row: TItem) => string;
	sortMaps: SortFieldMaps<TSortField>;
	getData?: (rows: TItem[]) => TItem[];
};

function createTanStackForConvex<TItem extends RowData, TSortField extends string>(
	convex: ConvexCursorTableState<TItem, TSortField, string>,
	options: {
		columns?: any[];
		getColumns?: () => any[];
		getRowId: (row: TItem) => string;
		sortMaps: SortFieldMaps<TSortField>;
		getData?: (rows: TItem[]) => TItem[];
	}
) {
	let rowSelection = $state<RowSelectionState>({});
	let columnVisibility = $state<VisibilityState>({});

	const pageIndex = $derived(convex.pageIndex);
	const pageSize = $derived(convex.pageSize);
	const sorting = $derived.by<SortingState>(() => {
		const sortBy = convex.sortBy;
		if (!sortBy) return [];
		const columnId = options.sortMaps.sortToColumn[sortBy.field];
		if (!columnId) return [];
		return [{ id: columnId, desc: sortBy.direction === 'desc' }];
	});

	const table = createSvelteTable<TItem>({
		get data() {
			return options.getData ? options.getData(convex.rows) : convex.rows;
		},
		get columns() {
			return options.getColumns ? options.getColumns() : (options.columns ?? []);
		},
		state: {
			get pagination() {
				return { pageIndex, pageSize };
			},
			get sorting() {
				return sorting;
			},
			get columnVisibility() {
				return columnVisibility;
			},
			get rowSelection() {
				return rowSelection;
			}
		},
		meta: {
			get isLoading() {
				return convex.isLoading;
			}
		},
		manualPagination: true,
		manualFiltering: true,
		manualSorting: true,
		get pageCount() {
			return convex.displayPageCount;
		},
		getRowId: options.getRowId,
		getCoreRowModel: getCoreRowModel(),
		onSortingChange: (updater) => {
			const nextSorting = applyUpdater(sorting, updater);
			if (nextSorting.length === 0) {
				convex.setSort(undefined);
				return;
			}
			const primarySort = nextSorting[0];
			const field = options.sortMaps.columnToSort[primarySort.id];
			if (!field) {
				convex.setSort(undefined);
				return;
			}
			convex.setSort({
				field,
				direction: primarySort.desc ? 'desc' : 'asc'
			});
		},
		onColumnVisibilityChange: (updater) => {
			columnVisibility = applyUpdater(columnVisibility, updater);
		},
		onRowSelectionChange: (updater) => {
			rowSelection = applyUpdater(rowSelection, updater);
		}
	});

	return {
		convex,
		table,
		get rowSelection() {
			return rowSelection;
		},
		setRowSelection(next: RowSelectionState) {
			rowSelection = next;
		},
		resetRowSelection() {
			rowSelection = {};
		},
		get selectedCount() {
			return Object.keys(rowSelection).length;
		},
		get sorting() {
			return sorting;
		},
		get pageIndex() {
			return pageIndex;
		},
		get pageSize() {
			return pageSize;
		}
	};
}

export function createConvexTanStackTable<
	TItem extends RowData,
	TFilterKeys extends string,
	TSortField extends string,
	TListQuery extends AnyQuery,
	TCountQuery extends AnyQuery,
	TUrlState extends TableUrlState<TFilterKeys>
>(
	options: CreateConvexTanStackTableOptions<
		TItem,
		TFilterKeys,
		TSortField,
		TListQuery,
		TCountQuery,
		TUrlState
	>
) {
	const convex = createConvexCursorTable(options.convex);
	return createTanStackForConvex(
		convex as ConvexCursorTableState<TItem, TSortField, string>,
		options
	);
}

export function createConvexTanStackTableFromState<
	TItem extends RowData,
	TSortField extends string
>(options: CreateConvexTanStackTableFromStateOptions<TItem, TSortField>) {
	return createTanStackForConvex(options.convex, options);
}
