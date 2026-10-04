<script lang="ts">
	import * as v from 'valibot';
	import { type SortingState } from '@tanstack/table-core';
	import { SvelteMap } from 'svelte/reactivity';
	import { getTranslate } from '@tolgee/svelte';
	import { useConvexClient } from 'convex-svelte';
	import { api } from '$lib/convex/_generated/api.js';
	import {
		setTogglePreferenceContext,
		setRemoveEmailContext,
		setRowSelectionContext,
		setRecipientsContext
	} from './recipients-context';
	import { createSvelteTable } from '$lib/components/ui/data-table/index.js';
	import { createRowSelection } from '$lib/components/ui/data-table/row-selection.svelte.ts';
	import ConvexCursorTableShell from '$lib/components/tables/convex-cursor-table-shell.svelte';
	import DataTableView from '$lib/components/tables/data-table-view.svelte';
	import { createConvexCursorTable } from '$lib/tables/convex/create-convex-cursor-table.svelte.ts';
	import { createCountPrediction } from '$lib/tables/convex/count-prediction.svelte.ts';
	import type { CursorListResult } from '$lib/tables/convex/contract';
	import { columns } from './columns.js';
	import type { NotificationRecipient } from '$lib/convex/admin/notificationPreferences/queries';
	import { adminCache } from '$lib/hooks/admin-cache.svelte.ts';
	import AddEmailDialog from './add-email-dialog.svelte';
	import { browser } from '$app/environment';
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
	const loadError = $derived(recipientsTable.error);
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
	const rowSelection = createRowSelection(() =>
		recipientsTable.rows.map((recipient) => recipient.email)
	);

	// Add email dialog state
	let addEmailDialogOpen = $state(false);

	// Derive recipients with optimistic updates applied
	const recipientsWithUpdates: NotificationRecipient[] = $derived.by(() =>
		recipientsTable.rows.map((recipient) => {
			const pending = pendingUpdates.get(recipient.email);
			return pending ? { ...recipient, ...pending } : recipient;
		})
	);

	const countPrediction = createCountPrediction({
		table: recipientsTable,
		cache: adminCache.recipientCount
	});

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
	setTogglePreferenceContext(togglePreference);
	setRemoveEmailContext(removeEmail);
	setRowSelectionContext(() => rowSelection.state);
	setRecipientsContext(() => recipientsWithUpdates);

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
				return rowSelection.state;
			}
		},
		manualPagination: true,
		manualFiltering: true,
		manualSorting: true,
		get pageCount() {
			return recipientsTable.pageCount;
		},
		getRowId: (row) => row.email,
		onSortingChange: (updater) => {
			const nextSorting = typeof updater === 'function' ? updater(sorting) : updater;
			if (nextSorting.length === 0) {
				recipientsTable.setSort(undefined);
				return;
			}
			const primarySort = nextSorting[0]!;
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
		onRowSelectionChange: rowSelection.onChange
	});
</script>

{#if browser}<ConvexCursorTableShell
		testIdPrefix="admin-settings"
		tableTestId="recipients-table"
		searchValue={tableParams.search}
		searchPlaceholder={$t('admin.settings.recipients_search_placeholder')}
		onSearchChange={recipientsTable.setSearch}
		pageIndex={recipientsTable.pageIndex}
		pageCount={recipientsTable.pageCount}
		pageSize={recipientsTable.pageSize}
		pageSizeOptions={PAGE_SIZE_NUM_OPTIONS}
		canPreviousPage={recipientsTable.canPreviousPage}
		canNextPage={recipientsTable.canNextPage}
		onFirstPage={recipientsTable.goFirst}
		onPreviousPage={recipientsTable.goPrevious}
		onNextPage={recipientsTable.goNext}
		onLastPage={recipientsTable.goLast}
		onPageSizeChange={recipientsTable.setPageSize}
		selectionText={$t('admin.settings.selected', {
			selected: rowSelection.count,
			total: countPrediction.total
		})}
	>
		{#snippet toolbarFilters()}
			<DataTableFilters {typeFilter} onFilterChange={handleFilterChange} />
		{/snippet}

		{#snippet toolbarActions()}
			<AddEmailDialog bind:open={addEmailDialogOpen} />
		{/snippet}

		{#snippet tableContent()}
			<DataTableView
				{table}
				loading={isLoading}
				error={loadError}
				skeletonRows={countPrediction.skeletonRows}
				emptyText={$t('admin.settings.no_recipients')}
				loadingText={$t('aria.loading')}
				testIdPrefix="recipients"
				rowTestId={(row) => `recipient-row-${row.id}`}
			/>
		{/snippet}
	</ConvexCursorTableShell>{/if}

<ConfirmDeleteDialog />
