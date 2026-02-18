<script lang="ts">
	import type { Snippet } from 'svelte';
	import { getTranslate } from '@tolgee/svelte';
	import * as Table from '$lib/components/ui/table/index.js';
	import FlexRender from '$lib/components/ui/data-table/flex-render.svelte';
	import {
		RenderComponentConfig,
		RenderSnippetConfig
	} from '$lib/components/ui/data-table/render-helpers.js';
	import ConvexCursorTableShell from '$lib/components/tables/convex-cursor-table-shell.svelte';
	import TableLoadingSkeleton from '$lib/components/tables/table-loading-skeleton.svelte';
	import type { BaseTableRenderConfig } from './types';
	import type { TableColumnMeta } from './types';
	import { buildColumnStyle } from './layout-presets';
	import { cn } from '$lib/utils.js';

	type Props = {
		table: any;
		config: BaseTableRenderConfig;
		toolbarFilters?: Snippet;
		toolbarActions?: Snippet;
		rowTestId?: (row: any) => string;
		onRowClick?: (row: any, event: MouseEvent) => void;
	};

	let {
		table,
		config,
		toolbarFilters: _toolbarFilters,
		toolbarActions: _toolbarActions,
		rowTestId,
		onRowClick
	}: Props = $props();
	const { t } = getTranslate();

	function getColumnMeta(def: { meta?: unknown }) {
		return (def.meta ?? {}) as TableColumnMeta;
	}
</script>

<ConvexCursorTableShell
	testIdPrefix={config.testIdPrefix}
	tableTestId={config.testIds?.table}
	searchValue={config.searchValue}
	searchPlaceholder={config.searchPlaceholder}
	onSearchChange={config.onSearchChange}
	pageIndex={config.pageIndex}
	pageCount={config.pageCount}
	pageSize={config.pageSize}
	pageSizeOptions={config.pageSizeOptions}
	canPreviousPage={config.canPreviousPage}
	canNextPage={config.canNextPage}
	onFirstPage={config.onFirstPage}
	onPreviousPage={config.onPreviousPage}
	onNextPage={config.onNextPage}
	onLastPage={config.onLastPage}
	onPageSizeChange={config.onPageSizeChange}
	rowsPerPageLabel={config.rowsPerPageLabel}
	selectionText={config.selectionText}
	showSearch={config.showSearch}
	showRowsPerPage={config.showRowsPerPage}
	searchTestId={config.testIds?.search}
	pageIndicatorTestId={config.testIds?.pageIndicator}
	paginationPrevTestId={config.testIds?.paginationPrev}
	paginationNextTestId={config.testIds?.paginationNext}
	paginationLastTestId={config.testIds?.paginationLast}
>
	{#snippet toolbarFilters()}
		{@render _toolbarFilters?.()}
	{/snippet}

	{#snippet toolbarActions()}
		{@render _toolbarActions?.()}
	{/snippet}

	{#snippet tableContent()}
		<Table.Root class="table-fixed">
			<Table.Header class="sticky top-0 z-10 bg-muted dark:bg-background">
				{#each table.getHeaderGroups() as headerGroup (headerGroup.id)}
					<Table.Row class="hover:[&>th]:bg-muted dark:hover:[&>th]:bg-background">
						{#each headerGroup.headers as header (header.id)}
							{@const headerMeta = getColumnMeta(header.column.columnDef)}
							<Table.Head
								class={cn(headerMeta.headClass)}
								style={buildColumnStyle({
									width: header.getSize(),
									minWidth: header.column.columnDef.minSize
								})}
							>
								{#if !header.isPlaceholder}
									<FlexRender
										content={header.column.columnDef.header}
										context={header.getContext()}
									/>
								{/if}
							</Table.Head>
						{/each}
					</Table.Row>
				{/each}
			</Table.Header>
			<Table.Body>
				{#if config.skeletonRowCount > 0 && table.options.meta?.isLoading && config.loadingStrategy === 'column-factory' && config.loadingCellFactory}
					{#if config.testIds?.loading}
						<Table.Row data-testid={config.testIds.loading} class="hidden">
							<Table.Cell colspan={config.colspan}>
								{$t(config.loadingLabelKey ?? 'aria.loading')}
							</Table.Cell>
						</Table.Row>
					{/if}
					{#each Array.from({ length: config.skeletonRowCount }) as _row, rowIndex (rowIndex)}
						<Table.Row data-testid={config.testIds?.loadingRow}>
							{#each table.getVisibleLeafColumns() as column, columnIndex (column.id)}
								{@const columnMeta = getColumnMeta(column.columnDef)}
								{@const loadingContent = config.loadingCellFactory({
									columnId: column.id,
									columnMeta,
									rowIndex,
									columnIndex
								})}
								<Table.Cell class={cn(columnMeta.cellClass)}>
									{#if loadingContent instanceof RenderComponentConfig}
										{@const { component: Component, props } = loadingContent}
										<Component {...props} />
									{:else if loadingContent instanceof RenderSnippetConfig}
										{@const { snippet, params } = loadingContent}
										{@render snippet(params)}
									{:else if loadingContent !== undefined && loadingContent !== null}
										{loadingContent}
									{:else}
										<span class="sr-only">{$t(config.loadingLabelKey ?? 'aria.loading')}</span>
									{/if}
								</Table.Cell>
							{/each}
						</Table.Row>
					{/each}
				{:else if config.skeletonRowCount > 0 && table.options.meta?.isLoading}
					<TableLoadingSkeleton
						columns={config.skeletonColumns}
						rowCount={config.skeletonRowCount}
						colspan={config.colspan}
						loadingTestId={config.testIds?.loading}
						loadingLabelKey={config.loadingLabelKey ?? 'aria.loading'}
						rowTestId={config.testIds?.loadingRow}
					/>
				{:else if table.options.meta?.isLoading}
					{#if config.testIds?.loading}
						<Table.Row data-testid={config.testIds.loading} class="hidden">
							<Table.Cell colspan={config.colspan}>
								{$t(config.loadingLabelKey ?? 'aria.loading')}
							</Table.Cell>
						</Table.Row>
					{/if}
				{:else if table.getRowModel().rows.length === 0}
					<Table.Row data-testid={config.emptyTestId ?? config.testIds?.empty}>
						<Table.Cell
							colspan={config.colspan}
							class="h-24 text-center text-muted-foreground hover:!bg-transparent"
						>
							{$t(config.emptyKey)}
						</Table.Cell>
					</Table.Row>
				{:else}
					{#each table.getRowModel().rows as row (row.id)}
						<Table.Row
							data-state={row.getIsSelected() && 'selected'}
							data-testid={rowTestId?.(row)}
							onclick={(event) => onRowClick?.(row, event)}
						>
							{#each row.getVisibleCells() as cell (cell.id)}
								{@const cellMeta = getColumnMeta(cell.column.columnDef)}
								<Table.Cell class={cn(cellMeta.cellClass)}>
									<FlexRender content={cell.column.columnDef.cell} context={cell.getContext()} />
								</Table.Cell>
							{/each}
						</Table.Row>
					{/each}
				{/if}
			</Table.Body>
		</Table.Root>
	{/snippet}
</ConvexCursorTableShell>
