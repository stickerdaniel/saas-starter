<script lang="ts">
	import * as v from 'valibot';
	import { getCoreRowModel, type RowSelectionState, type SortingState } from '@tanstack/table-core';
	import { SvelteMap } from 'svelte/reactivity';
	import * as Table from '$lib/components/ui/table/index.js';
	import { Skeleton } from '$lib/components/ui/skeleton/index.js';
	import { Checkbox } from '$lib/components/ui/checkbox/index.js';

	import { getTranslate, T } from '@tolgee/svelte';
	import { useConvexClient } from 'convex-svelte';
	import { api } from '$lib/convex/_generated/api.js';
	import { setContext } from 'svelte';
	import { createSvelteTable, FlexRender } from '$lib/components/ui/data-table/index.js';
	import ConvexCursorTableShell from '$lib/components/tables/convex-cursor-table-shell.svelte';
	import { createConvexCursorTable } from '$lib/tables/convex/create-convex-cursor-table.svelte';
	import type { CursorListResult } from '$lib/tables/convex/contract';
	import { columns } from './columns.js';
	import type { NotificationRecipient } from '$lib/convex/admin/notificationPreferences/queries';
	import { adminCache } from '$lib/hooks/admin-cache.svelte';
	import AddEmailDialog from './add-email-dialog.svelte';
	import DataTableFilters from './data-table-filters.svelte';
	import { ConfirmDeleteDialog } from '$lib/components/ui/confirm-delete-dialog';

	const { t } = getTranslate();
	const client = useConvexClient();

	type RecipientTypeFilter = 'all' | 'admin' | 'custom';
	type RecipientSortField = 'email' | 'name' | 'type';

	const SORT_COLUMN_TO_FIELD = {
		email: 'email',
		name: 'name',
		type: 'type'
	} as const;
	const SORT_FIELD_TO_COLUMN = {
		email: 'email',
		name: 'name',
		type: 'type'
	} as const;

	const PAGE_SIZE_OPTIONS = ['1', '10', '20', '30', '50'] as const;
	const PAGE_SIZE_NUM_OPTIONS = [1, 10, 20, 30, 50] as const;

	const recipientsTableParamsSchema = v.object({
		search: v.optional(v.fallback(v.string(), ''), ''),
		type: v.optional(v.fallback(v.picklist(['all', 'admin', 'custom']), 'all'), 'all'),
		sort: v.optional(v.fallback(v.string(), ''), ''),
		page: v.optional(v.fallback(v.string(), '1'), '1'),
		page_size: v.optional(v.fallback(v.picklist(PAGE_SIZE_OPTIONS), '10'), '10'),
		cursor: v.optional(v.fallback(v.string(), ''), '')
	});

	const recipientsTable = createConvexCursorTable<
		NotificationRecipient,
		'type',
		RecipientSortField,
		typeof api.admin.notificationPreferences.queries.listNotificationRecipients,
		typeof api.admin.notificationPreferences.queries.getNotificationRecipientCount,
		v.InferOutput<typeof recipientsTableParamsSchema>
	>({
		listQuery: api.admin.notificationPreferences.queries.listNotificationRecipients,
		countQuery: api.admin.notificationPreferences.queries.getNotificationRecipientCount,
		urlSchema: recipientsTableParamsSchema,
		defaultFilters: { type: 'all' },
		pageSizeOptions: PAGE_SIZE_OPTIONS,
		defaultPageSize: '10',
		sortFields: ['email', 'name', 'type'],
		buildListArgs: ({ cursor, pageSize, search, filters, sortBy }) => ({
			cursor: cursor ?? undefined,
			numItems: pageSize,
			search,
			typeFilter:
				filters.type === 'all' ? undefined : (filters.type as Exclude<RecipientTypeFilter, 'all'>),
			sortBy: sortBy
				? {
						field: sortBy.field,
						direction: sortBy.direction
					}
				: undefined
		}),
		buildCountArgs: ({ search, filters }) => ({
			search,
			typeFilter:
				filters.type === 'all' ? undefined : (filters.type as Exclude<RecipientTypeFilter, 'all'>)
		}),
		resolveLastPage: async ({ pageSize, search, filters }) => {
			const result = await client.query(
				api.admin.notificationPreferences.queries.resolveNotificationRecipientsLastPage,
				{
					numItems: pageSize,
					search,
					typeFilter:
						filters.type === 'all'
							? undefined
							: (filters.type as Exclude<RecipientTypeFilter, 'all'>)
				}
			);

			return {
				page: result.page,
				cursor: result.cursor
			};
		},
		toListResult: (result) => result as CursorListResult<NotificationRecipient>,
		toCount: (result) => result
	});

	const tableParams = $derived(recipientsTable.currentUrlState);
	const pageIndex = $derived(recipientsTable.pageIndex);
	const pageSize = $derived(recipientsTable.pageSize);
	const isLoading = $derived(recipientsTable.isLoading);
	const typeFilter = $derived(recipientsTable.filters.type as RecipientTypeFilter);
	const sorting = $derived.by<SortingState>(() => {
		const sortBy = recipientsTable.sortBy;
		if (!sortBy) return [];
		const columnId = SORT_FIELD_TO_COLUMN[sortBy.field];
		if (!columnId) return [];
		return [{ id: columnId, desc: sortBy.direction === 'desc' }];
	});

	// Track pending updates for optimistic UI
	let pendingUpdates = new SvelteMap<string, Record<string, boolean>>();

	// Row selection state
	let rowSelection = $state<RowSelectionState>({});

	// Add email dialog state
	let addEmailDialogOpen = $state(false);

	// Derive recipients with optimistic updates applied
	const recipientsWithUpdates: NotificationRecipient[] = $derived.by(() =>
		recipientsTable.rows.map((recipient) => {
			const pending = pendingUpdates.get(recipient.email);
			return pending ? { ...recipient, ...pending } : recipient;
		})
	);

	// Smart skeleton count
	const skeletonCount = $derived.by(() => {
		if (adminCache.recipientCount.current !== null) {
			const remaining = adminCache.recipientCount.current - pageIndex * pageSize;
			return Math.min(Math.max(remaining, 0), pageSize);
		}
		return pageSize;
	});

	const totalCount = $derived.by(() => {
		if (recipientsTable.hasLoadedCount) return recipientsTable.totalCount;
		return adminCache.recipientCount.current ?? 0;
	});
	const effectivePageCount = $derived.by(() => Math.max(1, Math.ceil(totalCount / pageSize)));

	async function togglePreference(
		email: string,
		field: 'notifyNewSupportTickets' | 'notifyUserReplies' | 'notifyNewSignups',
		currentValue: boolean
	) {
		const newValue = !currentValue;
		const existing = pendingUpdates.get(email) ?? {};
		pendingUpdates.set(email, { ...existing, [field]: newValue });

		try {
			await client.mutation(api.admin.notificationPreferences.mutations.updatePreference, {
				email,
				field,
				value: newValue
			});
		} catch (error) {
			const current = pendingUpdates.get(email);
			if (current) {
				delete current[field];
				if (Object.keys(current).length === 0) {
					pendingUpdates.delete(email);
				}
			}
			throw error;
		}
	}

	async function removeEmail(email: string) {
		await client.mutation(api.admin.notificationPreferences.mutations.removeCustomEmail, {
			email
		});
	}

	function handleFilterChange(filter: RecipientTypeFilter) {
		recipientsTable.setFilter('type', filter);
	}

	// Provide context for cell components
	setContext('onTogglePreference', togglePreference);
	setContext('onRemoveEmail', removeEmail);
	setContext('getRowSelection', () => rowSelection);
	setContext('getRecipients', () => recipientsWithUpdates);

	const table = createSvelteTable({
		get data() {
			return recipientsWithUpdates;
		},
		columns,
		state: {
			get pagination() {
				return { pageIndex, pageSize };
			},
			get sorting() {
				return sorting;
			},
			get rowSelection() {
				return rowSelection;
			}
		},
		manualPagination: true,
		manualFiltering: true,
		manualSorting: true,
		get pageCount() {
			return effectivePageCount;
		},
		getRowId: (row) => row.email,
		getCoreRowModel: getCoreRowModel(),
		onSortingChange: (updater) => {
			const nextSorting = typeof updater === 'function' ? updater(sorting) : updater;
			if (nextSorting.length === 0) {
				recipientsTable.setSort(undefined);
				return;
			}
			const primarySort = nextSorting[0];
			const field = SORT_COLUMN_TO_FIELD[primarySort.id as keyof typeof SORT_COLUMN_TO_FIELD];
			if (!field) {
				recipientsTable.setSort(undefined);
				return;
			}
			recipientsTable.setSort({
				field,
				direction: primarySort.desc ? 'desc' : 'asc'
			});
		},
		onRowSelectionChange: (updater) => {
			if (typeof updater === 'function') {
				rowSelection = updater(rowSelection);
			} else {
				rowSelection = updater;
			}
		}
	});

	$effect(() => {
		if (recipientsTable.hasLoadedCount) {
			adminCache.recipientCount.current = recipientsTable.totalCount;
		}
	});
</script>

<ConvexCursorTableShell
	testIdPrefix="admin-settings"
	tableTestId="recipients-table"
	searchValue={tableParams.search}
	searchPlaceholder={$t('admin.users.search_placeholder')}
	onSearchChange={recipientsTable.setSearch}
	pageIndex={recipientsTable.pageIndex}
	pageCount={effectivePageCount}
	pageSize={recipientsTable.pageSize}
	pageSizeOptions={PAGE_SIZE_NUM_OPTIONS}
	canPreviousPage={recipientsTable.canPreviousPage}
	canNextPage={recipientsTable.canNextPage}
	onFirstPage={recipientsTable.goFirst}
	onPreviousPage={recipientsTable.goPrevious}
	onNextPage={recipientsTable.goNext}
	onLastPage={recipientsTable.goLast}
	onPageSizeChange={recipientsTable.setPageSize}
	rowsPerPageLabel={$t('admin.users.rows_per_page')}
	pageIndicatorText={$t('admin.users.page_indicator', {
		current: recipientsTable.pageIndex + 1,
		total: effectivePageCount
	})}
	selectionText={$t('admin.settings.selected', {
		selected: Object.keys(rowSelection).length,
		total: totalCount
	})}
>
	{#snippet toolbarFilters()}
		<DataTableFilters {typeFilter} onFilterChange={handleFilterChange} />
	{/snippet}

	{#snippet toolbarActions()}
		<AddEmailDialog bind:open={addEmailDialogOpen} />
	{/snippet}

	{#snippet tableContent()}
		<Table.Root class="table-fixed">
			<Table.Header class="sticky top-0 z-10 bg-muted dark:bg-background">
				{#each table.getHeaderGroups() as headerGroup (headerGroup.id)}
					<Table.Row class="hover:[&>th]:bg-muted dark:hover:[&>th]:bg-background">
						{#each headerGroup.headers as header (header.id)}
							<Table.Head
								class="[&:has([role=checkbox])]:ps-3"
								style="width: {header.getSize()}px; min-width: {header.column.columnDef.minSize}px;"
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
					{#each Array(skeletonCount) as _, i (i)}
						<Table.Row data-testid="recipients-loading">
							<Table.Cell class="[&:has([role=checkbox])]:ps-3">
								<div class="flex items-center justify-center">
									<Checkbox disabled aria-label="Loading" />
								</div>
							</Table.Cell>
							<Table.Cell>
								<Skeleton class="h-4 w-40" />
							</Table.Cell>
							<Table.Cell>
								<span class="text-muted-foreground/50">-</span>
							</Table.Cell>
							<Table.Cell>
								<Skeleton class="h-[22px] w-14 rounded-md" />
							</Table.Cell>
							<Table.Cell class="[&:has([role=checkbox])]:ps-3">
								<div class="flex items-center justify-center">
									<Checkbox disabled aria-label="Loading" />
								</div>
							</Table.Cell>
							<Table.Cell class="[&:has([role=checkbox])]:ps-3">
								<div class="flex items-center justify-center">
									<Checkbox disabled aria-label="Loading" />
								</div>
							</Table.Cell>
							<Table.Cell class="[&:has([role=checkbox])]:ps-3">
								<div class="flex items-center justify-center">
									<Checkbox disabled aria-label="Loading" />
								</div>
							</Table.Cell>
							<Table.Cell>
								<div class="h-8 w-8" aria-hidden="true"></div>
							</Table.Cell>
						</Table.Row>
					{/each}
				{:else if table.getRowModel().rows.length === 0 || (isLoading && skeletonCount === 0)}
					<Table.Row data-testid="recipients-empty">
						<Table.Cell
							colspan={columns.length}
							class="h-24 text-center text-muted-foreground hover:!bg-transparent"
						>
							<T keyName="admin.settings.no_recipients" />
						</Table.Cell>
					</Table.Row>
				{:else}
					{#each table.getRowModel().rows as row (row.id)}
						<Table.Row
							data-state={row.getIsSelected() && 'selected'}
							data-testid="recipient-row-{row.id}"
						>
							{#each row.getVisibleCells() as cell (cell.id)}
								<Table.Cell class="[&:has([role=checkbox])]:ps-3">
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

<ConfirmDeleteDialog />
