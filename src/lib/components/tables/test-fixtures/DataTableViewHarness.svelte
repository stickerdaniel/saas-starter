<script lang="ts">
	import type { ColumnDef, ColumnVisibilityState, RowSelectionState } from '@tanstack/table-core';
	import { createSvelteTable, renderComponent } from '#lib/components/ui/data-table/index.js';
	import type { DataTableFeatures } from '#lib/components/ui/data-table/data-table.svelte.ts';
	import DataTableView from '../data-table-view.svelte';
	import SkeletonProbe from './SkeletonProbe.svelte';

	type Item = { id: string; name: string; role: string; note: string };

	let {
		loading = false,
		error = undefined,
		skeletonRows = 0,
		data = []
	}: { loading?: boolean; error?: unknown; skeletonRows?: number; data?: Item[] } = $props();

	const columns: Array<ColumnDef<DataTableFeatures, Item>> = [
		{ id: 'select', meta: { skeleton: { kind: 'checkbox' } } },
		{ accessorKey: 'name', meta: { skeleton: { kind: 'text' } } },
		{ accessorKey: 'note' },
		{ accessorKey: 'role', meta: { skeleton: { kind: 'badge' } } },
		{
			id: 'probe',
			meta: {
				skeleton: { kind: 'cell', render: () => renderComponent(SkeletonProbe, { label: 'probe' }) }
			}
		}
	];

	let columnVisibility = $state<ColumnVisibilityState>({});
	let rowSelection = $state<RowSelectionState>({});

	const table = createSvelteTable({
		get data() {
			return data;
		},
		columns,
		state: {
			get columnVisibility() {
				return columnVisibility;
			},
			get rowSelection() {
				return rowSelection;
			}
		},
		getRowId: (row) => row.id,
		onColumnVisibilityChange: (updater) => {
			columnVisibility = typeof updater === 'function' ? updater(columnVisibility) : updater;
		},
		onRowSelectionChange: (updater) => {
			rowSelection = typeof updater === 'function' ? updater(rowSelection) : updater;
		}
	});

	export function hide(columnId: string) {
		table.getColumn(columnId)!.toggleVisibility(false);
	}

	export function select(rowId: string) {
		table.getRow(rowId).toggleSelected(true);
	}
</script>

<DataTableView
	{table}
	{loading}
	{error}
	{skeletonRows}
	emptyText="Nothing here"
	loadingText="Loading rows"
	testIdPrefix="items"
	rowTestId={(row) => `item-${row.id}`}
/>
