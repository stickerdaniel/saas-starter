<script lang="ts">
	import SEOHead from '$lib/components/SEOHead.svelte';
	import * as v from 'valibot';
	import { type SortingState } from '@tanstack/table-core';
	import { T, getTranslate } from '@tolgee/svelte';
	import { useConvexClient } from 'convex-svelte';
	import { adminCache } from '$lib/hooks/admin-cache.svelte.ts';
	import { api } from '$lib/convex/_generated/api.js';
	import { createSvelteTable } from '$lib/components/ui/data-table/index.js';
	import ConvexCursorTableShell from '$lib/components/tables/convex-cursor-table-shell.svelte';
	import DataTableView from '$lib/components/tables/data-table-view.svelte';
	import { createConvexCursorTable } from '$lib/tables/convex/create-convex-cursor-table.svelte.ts';
	import { createCountPrediction } from '$lib/tables/convex/count-prediction.svelte.ts';
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
		buildListArgs: ({ cursor, pageSize, search, filters, sortBy }) => ({
			cursor: cursor ?? undefined,
			numItems: pageSize,
			search,
			actionFilter: filters.action === 'all' ? undefined : (filters.action as AuditLogAction),
			adminUserId: filters.admin || undefined,
			targetUserId: filters.target || undefined,
			sortBy: sortBy ? { field: 'timestamp', direction: sortBy.direction } : undefined
		}),
		// Count is order-independent, so the sort direction is intentionally omitted.
		buildCountArgs: ({ search, filters }) => ({
			search,
			actionFilter: filters.action === 'all' ? undefined : (filters.action as AuditLogAction),
			adminUserId: filters.admin || undefined,
			targetUserId: filters.target || undefined
		}),
		resolveLastPage: async ({ pageSize, search, filters, sortBy }) => {
			const result = await client.query(api.admin.auditLog.queries.resolveAuditLogLastPage, {
				numItems: pageSize,
				search,
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

	const tableParams = $derived(auditTable.currentUrlState);
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

	const countPrediction = createCountPrediction({
		table: auditTable,
		cache: adminCache.auditLogCount
	});
	// Renders "5000+" at the getAuditLogCount 5001-row cap.
	const totalEntriesLabel = $derived(
		countPrediction.total >= 5001 ? '5000+' : `${countPrediction.total}`
	);

	// The action filter combines with one user filter, served by the compound
	// indexes by_admin_action / by_target_action. Setting an action leaves the
	// active user filter in place; picking a user only clears the other user
	// filter (admin and target stay mutually exclusive) while keeping the action.
	// This delivers issue #659's "action X by/against user Y" without dropping a
	// filter the user still expects to be applied.
	function handleFilterChange(action: AuditLogAction | undefined) {
		auditTable.setFilter('action', action ?? 'all');
	}

	// Free-text search and a pinned user filter are mutually exclusive: the
	// search already scans admin+target names/emails, and the backend serves it
	// with an offset scan that ignores the admin/target index filters. Clearing
	// the active user filter when a search begins keeps the two from contradicting.
	function handleSearchChange(value: string) {
		if (value && (auditTable.filters.admin || auditTable.filters.target)) {
			auditTable.setFilter('admin', '');
			auditTable.setFilter('target', '');
		}
		auditTable.setSearch(value);
	}

	function filterByAdmin(userId: string) {
		auditTable.setSearch('');
		auditTable.setFilter('target', '');
		auditTable.setFilter('admin', userId);
	}

	function filterByTarget(userId: string) {
		auditTable.setSearch('');
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
			searchValue={tableParams.search}
			searchPlaceholder={$t('admin.audit_log.search_placeholder')}
			onSearchChange={handleSearchChange}
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
				<DataTableView
					{table}
					loading={isLoading}
					error={loadError}
					skeletonRows={countPrediction.skeletonRows}
					emptyText={$t('admin.audit_log.empty')}
					loadingText={$t('admin.audit_log.loading')}
					testIdPrefix="admin-audit-log"
					rowTestId={() => 'audit-log-row'}
				/>
			{/snippet}
		</ConvexCursorTableShell>{/if}
</div>
