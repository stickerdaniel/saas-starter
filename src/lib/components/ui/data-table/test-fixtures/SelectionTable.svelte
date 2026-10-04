<script lang="ts">
	import type { ColumnDef, RowSelectionState, Updater } from '@tanstack/table-core';
	import { createSvelteTable, type DataTableFeatures } from '../data-table.svelte.ts';
	import { createRowSelection } from '../row-selection.svelte.ts';

	type Item = { id: string };

	let { ids }: { ids: string[] } = $props();
	// The initial rows are fixed per mount; tests replace them through `setRows`.
	// svelte-ignore state_referenced_locally
	let data = $state.raw<Item[]>(ids.map((id) => ({ id })));

	const columns: Array<ColumnDef<DataTableFeatures, Item>> = [{ accessorKey: 'id' }];
	const selection = createRowSelection(() => data.map((row) => row.id));
	const table = createSvelteTable({
		get data() {
			return data;
		},
		columns,
		state: {
			get rowSelection() {
				return selection.state;
			}
		},
		manualPagination: true,
		manualFiltering: true,
		manualSorting: true,
		getRowId: (row) => row.id,
		onRowSelectionChange: selection.onChange
	});

	export function setRows(next: string[]) {
		data = next.map((id) => ({ id }));
	}
	export function toggleRow(id: string, value?: boolean) {
		table.getRow(id).toggleSelected(value);
	}
	export function togglePage(value?: boolean) {
		table.toggleAllPageRowsSelected(value);
	}
	export function setSelection(updater: Updater<RowSelectionState>) {
		table.setRowSelection(updater);
	}
</script>

<output data-testid="state">{Object.keys(selection.state).sort().join(',')}</output>
<output data-testid="count">{selection.count}</output>
<table>
	<tbody>
		{#each table.getRowModel().rows as row (row.id)}
			<tr data-testid="row-{row.id}" data-state={row.getIsSelected() ? 'selected' : undefined}>
				<td>{row.id}</td>
			</tr>
		{/each}
	</tbody>
</table>
