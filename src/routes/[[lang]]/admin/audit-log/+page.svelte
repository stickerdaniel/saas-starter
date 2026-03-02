<script lang="ts">
	import SEOHead from '$lib/components/SEOHead.svelte';
	import {
		type PaginationState,
		type SortingState,
		getCoreRowModel,
		getPaginationRowModel,
		getSortedRowModel
	} from '@tanstack/table-core';
	import * as Table from '$lib/components/ui/table/index.js';
	import { Skeleton } from '$lib/components/ui/skeleton/index.js';
	import { T, getTranslate } from '@tolgee/svelte';

	const { t } = getTranslate();
	import { useQuery } from 'convex-svelte';
	import { api } from '$lib/convex/_generated/api.js';
	import { createSvelteTable, FlexRender } from '$lib/components/ui/data-table/index.js';
	import { columns, type AuditLogRow } from './columns.js';
	import DataTableFilters from './data-table-filters.svelte';

	import SearchIcon from '@tabler/icons-svelte/icons/search';
	import ChevronsLeftIcon from '@tabler/icons-svelte/icons/chevrons-left';
	import ChevronsRightIcon from '@tabler/icons-svelte/icons/chevrons-right';
	import ChevronLeftIcon from '@tabler/icons-svelte/icons/chevron-left';
	import ChevronRightIcon from '@tabler/icons-svelte/icons/chevron-right';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Select from '$lib/components/ui/select/index.js';

	// Fetch audit logs (up to 500 entries for client-side handling)
	const auditLogsQuery = useQuery(api.admin.queries.listAuditLogs, { limit: 500 });

	// State
	let searchValue = $state('');
	let eventFilter = $state('all');
	let sorting = $state<SortingState>([{ id: 'timestamp', desc: true }]);
	let pagination = $state<PaginationState>({ pageIndex: 0, pageSize: 20 });

	// Resolve audit log rows
	const rows: AuditLogRow[] = $derived.by(() => {
		const data = auditLogsQuery.data;
		if (!data) return [];

		let filtered = data as AuditLogRow[];

		// Apply event filter
		if (eventFilter !== 'all') {
			filtered = filtered.filter((row) => row.action === eventFilter);
		}

		// Apply search filter (search admin/target user IDs and action)
		if (searchValue.trim()) {
			const search = searchValue.trim().toLowerCase();
			filtered = filtered.filter(
				(row) =>
					row.adminUserId.toLowerCase().includes(search) ||
					row.targetUserId.toLowerCase().includes(search) ||
					row.action.toLowerCase().includes(search) ||
					(row.adminEmail && row.adminEmail.toLowerCase().includes(search)) ||
					(row.targetEmail && row.targetEmail.toLowerCase().includes(search))
			);
		}

		return filtered;
	});

	const isLoading = $derived(auditLogsQuery.isLoading);

	const pageCount = $derived(Math.max(1, Math.ceil(rows.length / pagination.pageSize)));

	const PAGE_SIZE_OPTIONS = [10, 20, 30, 50] as const;

	// Create the table with client-side pagination and sorting
	const table = createSvelteTable({
		get data() {
			return rows;
		},
		columns,
		state: {
			get sorting() {
				return sorting;
			},
			get pagination() {
				return pagination;
			}
		},
		getCoreRowModel: getCoreRowModel(),
		getSortedRowModel: getSortedRowModel(),
		getPaginationRowModel: getPaginationRowModel(),
		onSortingChange: (updater) => {
			sorting = typeof updater === 'function' ? updater(sorting) : updater;
		},
		onPaginationChange: (updater) => {
			pagination = typeof updater === 'function' ? updater(pagination) : updater;
		}
	});

	function handleEventFilterChange(value: string) {
		eventFilter = value;
		// Reset to first page when filter changes
		pagination = { ...pagination, pageIndex: 0 };
	}

	function handleSearchChange(value: string) {
		searchValue = value;
		// Reset to first page when search changes
		pagination = { ...pagination, pageIndex: 0 };
	}

	const canPreviousPage = $derived(pagination.pageIndex > 0);
	const canNextPage = $derived(pagination.pageIndex < pageCount - 1);
</script>

<SEOHead
	title={$t('meta.admin.audit_log.title')}
	description={$t('meta.admin.audit_log.description')}
/>

<div class="flex flex-col gap-6 px-4 lg:px-6 xl:px-8 2xl:px-16" data-testid="audit-log-page">
	<!-- Header -->
	<div class="flex items-center justify-between">
		<h1 class="text-2xl font-bold"><T keyName="admin.audit_log.title" /></h1>
	</div>

	<div class="flex flex-col gap-6">
		<!-- Toolbar -->
		<div class="flex flex-wrap items-center justify-between gap-4">
			<div class="flex flex-wrap items-center gap-4">
				<div class="relative w-full max-w-sm sm:w-auto">
					<SearchIcon
						class="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
					/>
					<Input
						type="search"
						placeholder={$t('admin.audit_log.search_placeholder')}
						class="w-full pl-10 sm:w-64"
						data-testid="audit-log-search"
						value={searchValue}
						oninput={(event) => handleSearchChange((event.currentTarget as HTMLInputElement).value)}
					/>
				</div>

				<DataTableFilters {eventFilter} onEventFilterChange={handleEventFilterChange} />
			</div>
		</div>

		<!-- Table -->
		<div class="overflow-hidden rounded-md border" data-testid="audit-log-table">
			<Table.Root class="table-fixed">
				<Table.Header class="sticky top-0 z-10 bg-muted dark:bg-background">
					{#each table.getHeaderGroups() as headerGroup (headerGroup.id)}
						<Table.Row class="hover:[&>th]:bg-muted dark:hover:[&>th]:bg-background">
							{#each headerGroup.headers as header (header.id)}
								<Table.Head
									class="[&:has([role=checkbox])]:ps-3"
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
					{#if isLoading}
						<Table.Row data-testid="audit-log-loading" class="hidden">
							<Table.Cell colspan={columns.length}>
								<T keyName="admin.audit_log.loading" />
							</Table.Cell>
						</Table.Row>
						{#each Array(5) as _, i (i)}
							<Table.Row>
								<Table.Cell>
									<Skeleton class="h-4 w-32" />
								</Table.Cell>
								<Table.Cell>
									<Skeleton class="h-5 w-24 rounded-md" />
								</Table.Cell>
								<Table.Cell>
									<Skeleton class="h-4 w-40" />
								</Table.Cell>
								<Table.Cell>
									<Skeleton class="h-4 w-40" />
								</Table.Cell>
								<Table.Cell>
									<Skeleton class="h-4 w-28" />
								</Table.Cell>
							</Table.Row>
						{/each}
					{:else if table.getRowModel().rows.length === 0}
						<Table.Row>
							<Table.Cell
								colspan={columns.length}
								class="h-24 text-center text-muted-foreground hover:!bg-transparent"
								data-testid="audit-log-empty"
							>
								<T keyName="admin.audit_log.no_results" />
							</Table.Cell>
						</Table.Row>
					{:else}
						{#each table.getRowModel().rows as row (row.id)}
							<Table.Row>
								{#each row.getVisibleCells() as cell (cell.id)}
									<Table.Cell>
										<FlexRender content={cell.column.columnDef.cell} context={cell.getContext()} />
									</Table.Cell>
								{/each}
							</Table.Row>
						{/each}
					{/if}
				</Table.Body>
			</Table.Root>
		</div>

		<!-- Pagination -->
		<div class="flex items-center justify-between px-2">
			<div class="hidden flex-1 text-sm text-muted-foreground lg:flex">
				{$t('admin.audit_log.total_entries', { count: rows.length })}
			</div>

			<div class="flex w-full items-center gap-8 lg:w-fit">
				<div class="hidden items-center gap-2 lg:flex">
					<span class="text-sm font-medium">{$t('admin.audit_log.rows_per_page')}</span>
					<Select.Root
						type="single"
						value={`${pagination.pageSize}`}
						onValueChange={(value) => {
							pagination = { pageIndex: 0, pageSize: Number(value) };
						}}
					>
						<Select.Trigger size="sm" class="w-20">
							{pagination.pageSize}
						</Select.Trigger>
						<Select.Content side="top">
							{#each PAGE_SIZE_OPTIONS as option (option)}
								<Select.Item value={`${option}`}>{option}</Select.Item>
							{/each}
						</Select.Content>
					</Select.Root>
				</div>

				<div
					class="flex w-fit items-center justify-center text-sm font-medium"
					data-testid="audit-log-page-indicator"
				>
					{$t('admin.audit_log.page_indicator', {
						current: pagination.pageIndex + 1,
						total: pageCount
					})}
				</div>

				<div class="ml-auto flex items-center gap-2 lg:ml-0">
					<Button
						variant="outline"
						class="hidden h-8 w-8 p-0 lg:flex"
						onclick={() => {
							pagination = { ...pagination, pageIndex: 0 };
						}}
						disabled={!canPreviousPage}
					>
						<span class="sr-only">{$t('admin.audit_log.pagination.first')}</span>
						<ChevronsLeftIcon />
					</Button>
					<Button
						variant="outline"
						class="size-8"
						size="icon"
						onclick={() => {
							pagination = { ...pagination, pageIndex: pagination.pageIndex - 1 };
						}}
						disabled={!canPreviousPage}
						data-testid="audit-log-pagination-prev"
					>
						<span class="sr-only">{$t('admin.audit_log.pagination.previous')}</span>
						<ChevronLeftIcon />
					</Button>
					<Button
						variant="outline"
						class="size-8"
						size="icon"
						onclick={() => {
							pagination = { ...pagination, pageIndex: pagination.pageIndex + 1 };
						}}
						disabled={!canNextPage}
						data-testid="audit-log-pagination-next"
					>
						<span class="sr-only">{$t('admin.audit_log.pagination.next')}</span>
						<ChevronRightIcon />
					</Button>
					<Button
						variant="outline"
						class="hidden h-8 w-8 p-0 lg:flex"
						onclick={() => {
							pagination = { ...pagination, pageIndex: pageCount - 1 };
						}}
						disabled={!canNextPage}
						data-testid="audit-log-pagination-last"
					>
						<span class="sr-only">{$t('admin.audit_log.pagination.last')}</span>
						<ChevronsRightIcon />
					</Button>
				</div>
			</div>
		</div>
	</div>
</div>
