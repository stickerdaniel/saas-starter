<script lang="ts" module>
	import type { TableOptions } from '@tanstack/table-core';
	import type { DataTableFeatures } from '../data-table.svelte.ts';

	export type TextRow = { id: string; value?: unknown };
	export type TextTableOptions = Omit<TableOptions<DataTableFeatures, TextRow>, 'features'>;
</script>

<script lang="ts">
	import { FlexRender } from '../index.js';
	import { createSvelteTable } from '../data-table.svelte.ts';

	let { options }: { options: TextTableOptions } = $props();
	// The options are fixed for each mounted test.
	// svelte-ignore state_referenced_locally
	const table = createSvelteTable(options);
</script>

<table>
	<tbody>
		{#each table.getRowModel().rows as row (row.id)}
			<tr
				>{#each row.getVisibleCells() as cell (cell.id)}<td data-testid={row.id}
						><FlexRender {cell} /></td
					>{/each}</tr
			>
		{/each}
	</tbody>
</table>
