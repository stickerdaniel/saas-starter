<script lang="ts">
	import SEOHead from '$lib/components/SEOHead.svelte';
	import * as v from 'valibot';
	import { clamp } from '$lib/utils/math';
	import { type SortingState, getCoreRowModel } from '@tanstack/table-core';
	import * as Table from '$lib/components/ui/table/index.js';
	import { Skeleton } from '$lib/components/ui/skeleton/index.js';
	import { T, getTranslate } from '@tolgee/svelte';
	import { useConvexClient } from 'convex-svelte';
	import { adminCache } from '$lib/hooks/admin-cache.svelte';
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
		admin: v.optional(v.fallback(v.string(), ''), ''),
		target: v.optional(v.fallback(v.string(), ''), ''),
		sort: v.optional(v.fallback(v.string(), ''), ''),
		page: v.optional(v.fallback(v.string(), '1'), '1'),
		page_size: v.optional(v.fallback(v.picklist(PAGE_SIZE_OPTIONS), '20'), '20'),
		cursor: v.optional(v.fallback(v.string(), ''), '')
	});

	const auditTable = createConvexCursorTable<
		AuditLogItem,
		'action' | 'admin' | 'target',
		'timestamp',
		typeof api.admin.auditLog.queries.listAuditLogs,
		typeof api.admin.auditLog.queries.getAuditLogCount,
		v.InferOutput<typeof auditLogTableParamsSchema>
	>({
		listQuery: api.admin.auditLog.queries.listAuditLogs,
		countQuery: api.admin.auditLog.queries.getAuditLogCount,
		urlSchema: auditLogTableParamsSchema,
		defaultFilters: { action: 'all', admin: '', target: '' },
		pageSizeOptions: PAGE_SIZE_OPTIONS,
		defaultPageSize: '20',
		sortFields: ['timestamp'],
		buildListArgs: ({ cursor, pageSize, filters, sortBy }) => ({
			cursor: cursor ?? undefined,
			numItems: pageSize,
			actionFilter: filters.action === 'all' ? undefined : (filters.action as AuditLogAction),
			adminUserId: filters.admin || undefined,
			targetUserId: filters.target || undefined,
			sortBy: sortBy ? { field: 'timestamp', direction: sortBy.direction } : undefined
		}),
		// Count is order-independent, so the sort direction is intentionally omitted.
		buildCountArgs: ({ filters }) => ({
			actionFilter: filters.action === 'all' ? undefined : (filters.action as AuditLogAction),
			adminUserId: filters.admin || undefined,
			targetUserId: filters.target || undefined
		}),
		resolveLastPage: async ({ pageSize, filters, sortBy }) => {
			const result = await client.query(api.admin.auditLog.queries.resolveAuditLogLastPage, {
				numItems: pageSize,
				actionFilter: filters.action === 'all' ? undefined : (filters.action as AuditLogAction),
				adminUserId: filters.admin || undefined,
				targetUserId: filters.target || undefined,
				sortBy: sortBy ? { field: 'timestamp', direction: sortBy.direction } : undefined
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
	const adminFilterId = $derived(auditTable.filters.admin || undefined);
	const targetFilterId = $derived(auditTable.filters.target || undefined);
	const sorting = $derived.by<SortingState>(() => {
		const sortBy = auditTable.sortBy;
		if (!sortBy) return [];
		return [{ id: 'timestamp', desc: sortBy.direction === 'desc' }];
	});

	// Total entry count for the footer: prefer the freshly loaded count, falling
	// back to the persisted cache so it shows immediately on first paint. Renders
	// "5000+" at the getAuditLogCount 5001-row cap.
	const totalEntries = $derived(
		auditTable.hasLoadedCount ? auditTable.totalCount : (adminCache.auditLogCount.current ?? 0)
	);
	const totalEntriesLabel = $derived(totalEntries >= 5001 ? '5000+' : `${totalEntries}`);

	// Skeleton prediction: use the cached count so first paint renders only as
	// many skeleton rows as the current page will actually hold (falls back to a
	// full page when nothing is cached yet).
	const skeletonCount = $derived.by(() => {
		if (adminCache.auditLogCount.current !== null) {
			const remaining = adminCache.auditLogCount.current - pageIndex * pageSize;
			return clamp(remaining, 0, pageSize);
		}
		return pageSize;
	});

	// Persist the audit log count once it loads so later visits predict skeletons.
	$effect(() => {
		if (auditTable.hasLoadedCount) {
			adminCache.auditLogCount.current = auditTable.totalCount;
		}
	});

	// The action filter combines with one user filter, served by the compound
	// indexes by_admin_action / by_target_action. Setting an action leaves the
	// active user filter in place; picking a user only clears the other user
	// filter (admin and target stay mutually exclusive) while keeping the action.
	// This delivers issue #659's "action X by/against user Y" without dropping a
	// filter the user still expects to be applied.
	function handleFilterChange(action: AuditLogAction | undefined) {
		auditTable.setFilter('action', action ?? 'all');
	}

	function filterByAdmin(userId: string) {
		auditTable.setFilter('target', '');
		auditTable.setFilter('admin', userId);
	}

	function filterByTarget(userId: string) {
		auditTable.setFilter('admin', '');
		auditTable.setFilter('target', userId);
	}

	function clearUserFilter() {
		auditTable.setFilter('admin', '');
		auditTable.setFilter('target', '');
	}

	const columns = $derived(
		createColumns(data.lang ?? 'en', {
			onFilterAdmin: filterByAdmin,
			onFilterTarget: filterByTarget
		})
	);

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
			},
			get sorting() {
				return sorting;
			}
		},
		manualPagination: true,
		manualFiltering: true,
		manualSorting: true,
		get pageCount() {
			return auditTable.pageCount;
		},
		getRowId: (row) => row.id,
		getCoreRowModel: getCoreRowModel(),
		onSortingChange: (updater) => {
			const nextSorting = typeof updater === 'function' ? updater(sorting) : updater;
			if (nextSorting.length === 0) {
				auditTable.setSort(undefined);
				return;
			}
			const primarySort = nextSorting[0]!;
			if (primarySort.id !== 'timestamp') {
				auditTable.setSort(undefined);
				return;
			}
			auditTable.setSort({
				field: 'timestamp',
				direction: primarySort.desc ? 'desc' : 'asc'
			});
		}
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
			selectionText={$t('admin.audit_log.total_entries', { count: totalEntriesLabel })}
		>
			{#snippet toolbarFilters()}
				<DataTableFilters
					{actionFilter}
					adminUserId={adminFilterId}
					targetUserId={targetFilterId}
					onFilterChange={handleFilterChange}
					onClearUserFilter={clearUserFilter}
				/>
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
									<Table.Cell>
										<div class="flex h-5 items-center"><Skeleton class="h-4 w-32" /></div>
									</Table.Cell>
									<Table.Cell>
										<Skeleton class="h-5 w-20 rounded-4xl" />
									</Table.Cell>
									<Table.Cell>
										<div class="flex items-center gap-2">
											<Skeleton class="size-8 shrink-0 rounded-full" />
											<div class="min-w-0">
												<div class="flex h-5 items-center"><Skeleton class="h-4 w-24" /></div>
												<div class="flex h-4 items-center"><Skeleton class="h-3 w-32" /></div>
											</div>
										</div>
									</Table.Cell>
									<Table.Cell>
										<div class="flex items-center gap-2">
											<Skeleton class="size-8 shrink-0 rounded-full" />
											<div class="min-w-0">
												<div class="flex h-5 items-center"><Skeleton class="h-4 w-24" /></div>
												<div class="flex h-4 items-center"><Skeleton class="h-3 w-32" /></div>
											</div>
										</div>
									</Table.Cell>
									<Table.Cell>
										<div class="flex h-5 items-center"><Skeleton class="h-4 w-40" /></div>
									</Table.Cell>
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
										<Table.Cell>
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
