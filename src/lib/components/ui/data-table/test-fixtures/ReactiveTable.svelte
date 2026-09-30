<script lang="ts">
	import type {
		ColumnDef,
		ColumnVisibilityState,
		RowSelectionState,
		SortingState
	} from '@tanstack/table-core';
	import { createSvelteTable, type DataTableFeatures } from '../data-table.svelte.ts';
	type Item = { id: string; name: string };
	let data = $state.raw<Item[]>([
		{ id: 'a', name: 'Zulu' },
		{ id: 'b', name: 'Alpha' }
	]);
	let columns = $state.raw<Array<ColumnDef<DataTableFeatures, Item>>>([{ accessorKey: 'name' }]);
	let sorting = $state<SortingState>([]);
	let rowSelection = $state<RowSelectionState>({});
	let columnVisibility = $state<ColumnVisibilityState>({});
	let pageCount = $state(3);
	const table = createSvelteTable({
		get data() {
			return data;
		},
		get columns() {
			return columns;
		},
		state: {
			get sorting() {
				return sorting;
			},
			get rowSelection() {
				return rowSelection;
			},
			get columnVisibility() {
				return columnVisibility;
			},
			pagination: { pageIndex: 0, pageSize: 2 }
		},
		manualPagination: true,
		manualSorting: true,
		manualFiltering: true,
		get pageCount() {
			return pageCount;
		},
		getRowId: (row) => row.id,
		onSortingChange: (updater) => {
			sorting = typeof updater === 'function' ? updater(sorting) : updater;
		},
		onRowSelectionChange: (updater) => {
			rowSelection = typeof updater === 'function' ? updater(rowSelection) : updater;
		},
		onColumnVisibilityChange: (updater) => {
			columnVisibility = typeof updater === 'function' ? updater(columnVisibility) : updater;
		}
	});
	export function replaceRows() {
		data = [
			{ id: 'b', name: 'Bravo' },
			{ id: 'c', name: 'Charlie' }
		];
	}
	export function replaceColumns() {
		columns = [{ accessorKey: 'id' }, { accessorKey: 'name' }];
	}
	export function sort() {
		table.getColumn('name')!.toggleSorting(false);
	}
	export function select() {
		table.getRow('b').toggleSelected(true);
	}
	export function hideName() {
		table.getColumn('name')!.toggleVisibility(false);
	}
	export function updatePageCount() {
		pageCount = 5;
	}
</script>

<output data-testid="sorting">{JSON.stringify(sorting)}</output>
<output data-testid="selected"
	>{table
		.getSelectedRowModel()
		.rows.map((row) => row.id)
		.join(',')}</output
>
<output data-testid="pages">{table.getPageCount()}</output>
<table>
	<thead
		><tr
			>{#each table.getVisibleLeafColumns() as column (column.id)}<th>{column.id}</th>{/each}</tr
		></thead
	>
	<tbody>
		{#each table.getRowModel().rows as row (row.id)}
			<tr
				>{#each row.getVisibleCells() as cell (cell.id)}<td>{cell.getValue()}</td>{/each}</tr
			>
		{/each}
	</tbody>
</table>
