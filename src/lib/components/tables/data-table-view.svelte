<script lang="ts" generics="TData extends RowData">
	import type { Row, RowData, Table as TanStackTable } from '@tanstack/table-core';
	import { getTranslate } from '@tolgee/svelte';
	import * as Table from '#lib/components/ui/table/index.js';
	import { FlexRender } from '#lib/components/ui/data-table/index.js';
	import type { DataTableFeatures } from '#lib/components/ui/data-table/data-table.svelte.ts';
	import DataTableSkeletonCell from './data-table-skeleton-cell.svelte';

	type Props = {
		table: TanStackTable<DataTableFeatures, TData>;
		loading: boolean;
		error: unknown;
		/** Placeholder rows while loading; zero shows the empty row instead. */
		skeletonRows: number;
		emptyText: string;
		/** Text of the hidden loading marker row. */
		loadingText: string;
		/** Names the `-loading`, `-error` and `-empty` test ids. */
		testIdPrefix: string;
		rowTestId?: (row: Row<DataTableFeatures, TData>) => string;
	};

	let {
		table,
		loading,
		error,
		skeletonRows,
		emptyText,
		loadingText,
		testIdPrefix,
		rowTestId
	}: Props = $props();

	const { t } = getTranslate();
	let header = $state<HTMLTableSectionElement | null>(null);
	let headerHeight = $state(0);

	$effect(() => {
		if (!header) return;
		const element = header;
		const measure = () => (headerHeight = element.getBoundingClientRect().height);
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(element);
		return () => observer.disconnect();
	});

	const columns = $derived(table.getVisibleLeafColumns());
	const rows = $derived(table.getRowModel().rows);
	const skeletonRowIndexes = $derived(Array.from({ length: skeletonRows }, (_, index) => index));
</script>

<!-- The skeleton rows are hidden from assistive technology, so the waiting state is
     announced here. The region stays mounted: a status that appears already holding
     its text is not reliably read out. -->
<div role="status" class="sr-only">{loading && skeletonRows > 0 ? loadingText : ''}</div>

<Table.Root
	class="table-fixed"
	container={{
		class: 'min-h-0 max-h-[min(32rem,60dvh)] flex-auto overflow-auto scroll-p-1',
		scrollPaddingTop: `calc(${headerHeight}px + 0.25rem)`
	}}
>
	<Table.Header sticky bind:ref={header}>
		{#each table.getHeaderGroups() as headerGroup (headerGroup.id)}
			<Table.Row variant="header">
				{#each headerGroup.headers as header (header.id)}
					<Table.Head
						class="w-(--column-width) min-w-(--column-min-width) [&:has([role=checkbox])]:ps-3"
						style="--column-width: {header.getSize()}px; --column-min-width: {header.column
							.columnDef.minSize}px;"
					>
						{#if !header.isPlaceholder}
							<FlexRender {header} />
						{/if}
					</Table.Head>
				{/each}
			</Table.Row>
		{/each}
	</Table.Header>
	<Table.Body>
		{#if loading && skeletonRows > 0}
			<Table.Row data-testid="{testIdPrefix}-loading" class="hidden">
				<Table.Cell colspan={columns.length}>{loadingText}</Table.Cell>
			</Table.Row>
			{#each skeletonRowIndexes as index (index)}
				<Table.Row aria-hidden="true">
					{#each columns as column (column.id)}
						<Table.Cell class="[&:has([role=checkbox])]:ps-3">
							<DataTableSkeletonCell skeleton={column.columnDef.meta?.skeleton} />
						</Table.Cell>
					{/each}
				</Table.Row>
			{/each}
		{:else if error}
			<Table.Row variant="inert">
				<Table.Cell
					colspan={columns.length}
					class="h-24 text-center"
					data-testid="{testIdPrefix}-error"
				>
					<span class="text-destructive">{$t('common.load_error')}</span>
				</Table.Cell>
			</Table.Row>
		{:else if rows.length === 0 || loading}
			<Table.Row variant="inert">
				<Table.Cell
					colspan={columns.length}
					class="h-24 text-center"
					data-testid="{testIdPrefix}-empty"
				>
					<span class="text-muted-foreground">{emptyText}</span>
				</Table.Cell>
			</Table.Row>
		{:else}
			{#each rows as row (row.id)}
				<Table.Row
					data-state={row.getIsSelected() ? 'selected' : undefined}
					data-testid={rowTestId?.(row)}
				>
					{#each row.getVisibleCells() as cell (cell.id)}
						<Table.Cell class="[&:has([role=checkbox])]:ps-3">
							<FlexRender {cell} />
						</Table.Cell>
					{/each}
				</Table.Row>
			{/each}
		{/if}
	</Table.Body>
</Table.Root>
