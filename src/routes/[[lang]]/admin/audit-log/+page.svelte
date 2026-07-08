<script lang="ts">
	import SEOHead from '$lib/components/SEOHead.svelte';
	import * as v from 'valibot';
	import { clamp } from '$lib/utils/math';
	import { getCoreRowModel } from '@tanstack/table-core';
	import * as Table from '$lib/components/ui/table/index.js';
	import { Skeleton } from '$lib/components/ui/skeleton/index.js';
	import { T, getTranslate } from '@tolgee/svelte';
	import { useConvexClient } from 'convex-svelte';
	import { api } from '$lib/convex/_generated/api.js';
	import { createSvelteTable, FlexRender } from '$lib/components/ui/data-table/index.js';
	import ConvexCursorTableShell from '$lib/components/tables/convex-cursor-table-shell.svelte';
	import { createConvexCursorTable } from '$lib/tables/convex/create-convex-cursor-table.svelte';
	import type { CursorListResult } from '$lib/tables/convex/contract';
	import type { AuditLogItem } from '$lib/convex/admin/auditLog/queries';
	import { browser } from '$app/environment';
	import { createColumns } from './columns.js';
	import DataTableFilters from './data-table-filters.svelte';
	import type { PageData } from './$types';

	const { t } = getTranslate();

	let { data }: { data: PageData } = $props();

	type AuditLogAction = AuditLogItem['action'];

	const client = useConvexClient();

	const columns = $derived(createColumns(data.lang ?? 'en'));

	const PAGE_SIZE_OPTIONS = ['1', '10', '20', '30', '40', '50'] as const;
	const PAGE_SIZE_NUM_OPTIONS = [1, 10, 20, 30, 40, 50] as const;

	const auditLogTableParamsSchema = v.object({
		search: v.optional(v.fallback(v.string(), ''), ''),
		action: v.optional(
			v.fallback(
				v.picklist([
					'all',
					'impersonate',
					'stop_impersonation',
					'ban_user',
					'unban_user',
					'revoke_sessions',
					'set_role'
				]),
				'all'
			),
			'all'
		),
		sort: v.optional(v.fallback(v.string(), ''), ''),
		page: v.optional(v.fallback(v.string(), '1'), '1'),
		page_size: v.optional(v.fallback(v.picklist(PAGE_SIZE_OPTIONS), '20'), '20'),
		cursor: v.optional(v.fallback(v.string(), ''), '')
	});

	const auditTable = createConvexCursorTable<
		AuditLogItem,
		'action',
		never,
		typeof api.admin.auditLog.queries.listAuditLogs,
		typeof api.admin.auditLog.queries.getAuditLogCount,
		v.InferOutput<typeof auditLogTableParamsSchema>
	>({
		listQuery: api.admin.auditLog.queries.listAuditLogs,
		countQuery: api.admin.auditLog.queries.getAuditLogCount,
		urlSchema: auditLogTableParamsSchema,
		defaultFilters: { action: 'all' },
		pageSizeOptions: PAGE_SIZE_OPTIONS,
		defaultPageSize: '20',
		sortFields: [],
		buildListArgs: ({ cursor, pageSize, filters }) => ({
			cursor: cursor ?? undefined,
			numItems: pageSize,
			actionFilter: filters.action === 'all' ? undefined : (filters.action as AuditLogAction)
		}),
		buildCountArgs: ({ filters }) => ({
			actionFilter: filters.action === 'all' ? undefined : (filters.action as AuditLogAction)
		}),
		resolveLastPage: async ({ pageSize, filters }) => {
			const result = await client.query(api.admin.auditLog.queries.resolveAuditLogLastPage, {
				numItems: pageSize,
				actionFilter: filters.action === 'all' ? undefined : (filters.action as AuditLogAction)
			});
			return { page: result.page, cursor: result.cursor };
		},
		toListResult: (result) => result as CursorListResult<AuditLogItem>,
		toCount: (result) => result
	});

	const pageIndex = $derived(auditTable.pageIndex);
	const pageSize = $derived(auditTable.pageSize);
	const isLoading = $derived(auditTable.isLoading);
	const loadError = $derived(auditTable.error);
	const actionFilter = $derived.by(() =>
		auditTable.filters.action === 'all' ? undefined : (auditTable.filters.action as AuditLogAction)
	);

	const skeletonCount = $derived.by(() => {
		if (auditTable.hasLoadedCount) {
			const remaining = auditTable.totalCount - pageIndex * pageSize;
			return clamp(remaining, 0, pageSize);
		}
		return pageSize;
	});

	function handleFilterChange(action: AuditLogAction | undefined) {
		auditTable.setFilter('action', action ?? 'all');
	}

	const table = createSvelteTable({
		get data() {
			return auditTable.rows;
		},
		get columns() {
			return columns;
		},
		state: {
			get pagination() {
				return { pageIndex, pageSize };
			}
		},
		manualPagination: true,
		manualFiltering: true,
		manualSorting: true,
		get pageCount() {
			return auditTable.pageCount;
		},
		getRowId: (row) => row.id,
		getCoreRowModel: getCoreRowModel()
	});
</script>

<SEOHead
	title={$t('meta.admin.audit_log.title')}
	description={$t('meta.admin.audit_log.description')}
	noindex
/>

<div class="flex flex-col gap-6 px-4 lg:px-6 xl:px-8 2xl:px-16" data-testid="admin-audit-log-page">
	<div class="flex items-center justify-between">
		<h1 class="text-2xl font-bold"><T keyName="admin.audit_log.title" /></h1>
	</div>

	{#if browser}<ConvexCursorTableShell
			testIdPrefix="admin-audit-log"
			tableTestId="admin-audit-log-table"
			showSearch={false}
			searchValue=""
			searchPlaceholder=""
			onSearchChange={() => {}}
			pageIndex={auditTable.pageIndex}
			pageCount={auditTable.pageCount}
			pageSize={auditTable.pageSize}
			pageSizeOptions={PAGE_SIZE_NUM_OPTIONS}
			canPreviousPage={auditTable.canPreviousPage}
			canNextPage={auditTable.canNextPage}
			onFirstPage={auditTable.goFirst}
			onPreviousPage={auditTable.goPrevious}
			onNextPage={auditTable.goNext}
			onLastPage={auditTable.goLast}
			onPageSizeChange={auditTable.setPageSize}
		>
			{#snippet toolbarFilters()}
				<DataTableFilters {actionFilter} onFilterChange={handleFilterChange} />
			{/snippet}

			{#snippet tableContent()}
				<Table.Root class="table-fixed">
					<Table.Header class="sticky top-0 z-10 bg-muted dark:bg-background">
						{#each table.getHeaderGroups() as headerGroup (headerGroup.id)}
							<Table.Row class="hover:[&>th]:bg-muted dark:hover:[&>th]:bg-background">
								{#each headerGroup.headers as header (header.id)}
									<Table.Head
										style="width: {header.getSize()}px; min-width: {header.column.columnDef
											.minSize}px;"
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
						{#if isLoading && skeletonCount > 0}
							<Table.Row data-testid="admin-audit-log-loading" class="hidden">
								<Table.Cell colspan={columns.length}>
									<T keyName="admin.audit_log.loading" />
								</Table.Cell>
							</Table.Row>
							{#each Array(skeletonCount) as _, i (i)}
								<Table.Row>
									<Table.Cell><Skeleton class="h-4 w-32" /></Table.Cell>
									<Table.Cell><Skeleton class="h-5 w-20 rounded-md" /></Table.Cell>
									<Table.Cell>
										<Skeleton class="h-4 w-24" />
										<Skeleton class="mt-1 h-3 w-32" />
									</Table.Cell>
									<Table.Cell>
										<Skeleton class="h-4 w-24" />
										<Skeleton class="mt-1 h-3 w-32" />
									</Table.Cell>
									<Table.Cell><Skeleton class="h-4 w-40" /></Table.Cell>
								</Table.Row>
							{/each}
						{:else if loadError}
							<Table.Row class="hover:!bg-transparent">
								<Table.Cell
									colspan={columns.length}
									class="h-24 text-center text-destructive"
									data-testid="admin-audit-log-error"
								>
									<T keyName="common.load_error" />
								</Table.Cell>
							</Table.Row>
						{:else if table.getRowModel().rows.length === 0 || (isLoading && skeletonCount === 0)}
							<Table.Row class="hover:!bg-transparent">
								<Table.Cell
									colspan={columns.length}
									class="h-24 text-center text-muted-foreground"
									data-testid="admin-audit-log-empty"
								>
									<T keyName="admin.audit_log.empty" />
								</Table.Cell>
							</Table.Row>
						{:else}
							{#each table.getRowModel().rows as row (row.id)}
								<Table.Row data-testid="audit-log-row">
									{#each row.getVisibleCells() as cell (cell.id)}
										<Table.Cell class="align-top">
											<FlexRender
												content={cell.column.columnDef.cell}
												context={cell.getContext()}
											/>
										</Table.Cell>
									{/each}
								</Table.Row>
							{/each}
						{/if}
					</Table.Body>
				</Table.Root>
			{/snippet}
		</ConvexCursorTableShell>{/if}
</div>
