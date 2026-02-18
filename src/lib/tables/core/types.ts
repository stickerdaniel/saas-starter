import type { ColumnDef, RowData, SortingState, VisibilityState } from '@tanstack/table-core';
import type { TableSkeletonColumn } from '$lib/components/tables/table-loading-skeleton.js';

export type TableColumnMeta = {
	headClass?: string;
	cellClass?: string;
	skeleton?: Omit<TableSkeletonColumn, 'key'>;
};

export type LoadingCellFactoryArgs = {
	columnId: string;
	columnMeta: TableColumnMeta;
	rowIndex: number;
	columnIndex: number;
};

export type CanonicalTableTestIds = {
	table?: string;
	search?: string;
	pageIndicator?: string;
	paginationPrev?: string;
	paginationNext?: string;
	paginationLast?: string;
	loading?: string;
	empty?: string;
	loadingRow?: string;
};

export type BaseTableConfig<TData extends RowData> = {
	columns: ColumnDef<TData>[];
	getRowId: (row: TData) => string;
};

export type BaseTableRenderConfig = {
	testIdPrefix: string;
	searchValue: string;
	searchPlaceholder: string;
	onSearchChange: (value: string) => void;
	showSearch?: boolean;
	pageIndex: number;
	pageCount: number;
	pageSize: number;
	pageSizeOptions: readonly number[];
	showRowsPerPage?: boolean;
	canPreviousPage: boolean;
	canNextPage: boolean;
	onFirstPage: () => void;
	onPreviousPage: () => void | Promise<void>;
	onNextPage: () => void;
	onLastPage: () => void | Promise<void>;
	onPageSizeChange: (value: number) => void;
	rowsPerPageLabel: string;
	selectionText?: string;
	emptyKey: string;
	emptyTestId?: string;
	loadingLabelKey?: string;
	loadingStrategy?: 'generic-skeleton' | 'column-factory';
	loadingCellFactory?: (args: LoadingCellFactoryArgs) => unknown;
	skeletonColumns: TableSkeletonColumn[];
	skeletonRowCount: number;
	colspan: number;
	testIds?: CanonicalTableTestIds;
};

export type SortFieldMaps<TSortField extends string> = {
	columnToSort: Record<string, TSortField>;
	sortToColumn: Record<TSortField, string>;
};

export type BaseTableState = {
	sorting: SortingState;
	columnVisibility: VisibilityState;
	selectedCount: number;
};
