<script lang="ts">
	import * as v from 'valibot';
	import { SvelteMap } from 'svelte/reactivity';
	import { getTranslate } from '@tolgee/svelte';
	import { useConvexClient } from 'convex-svelte';
	import { api } from '$lib/convex/_generated/api.js';
	import { setContext } from 'svelte';
	import ConvexTanStackTable from '$lib/tables/convex/convex-tanstack-table.svelte';
	import { createConvexTanStackTable } from '$lib/tables/convex/create-convex-tanstack-table.svelte';
	import type { BaseTableRenderConfig } from '$lib/tables/core/types';
	import { getTableSkeletonColumnsFromColumnDefs } from '$lib/components/tables/table-loading-skeleton.js';
	import type { CursorListResult } from '$lib/tables/convex/contract';
	import { columns } from './columns.js';
	import type { NotificationRecipient } from '$lib/convex/admin/notificationPreferences/queries';
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

	// Track pending updates for optimistic UI
	let pendingUpdates = new SvelteMap<string, Record<string, boolean>>();

	// Add email dialog state
	let addEmailDialogOpen = $state(false);

	const recipientsTable = createConvexTanStackTable<
		NotificationRecipient,
		'type',
		RecipientSortField,
		typeof api.admin.notificationPreferences.queries.listNotificationRecipients,
		typeof api.admin.notificationPreferences.queries.getNotificationRecipientCount,
		v.InferOutput<typeof recipientsTableParamsSchema>
	>({
		convex: {
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
					filters.type === 'all'
						? undefined
						: (filters.type as Exclude<RecipientTypeFilter, 'all'>),
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
		},
		columns,
		getRowId: (row) => row.email,
		sortMaps: {
			columnToSort: SORT_COLUMN_TO_FIELD,
			sortToColumn: SORT_FIELD_TO_COLUMN
		},
		getData: (rows) =>
			rows.map((recipient) => {
				const pending = pendingUpdates.get(recipient.email);
				return pending ? { ...recipient, ...pending } : recipient;
			})
	});

	const tableParams = $derived(recipientsTable.convex.currentUrlState);
	const typeFilter = $derived(recipientsTable.convex.filters.type as RecipientTypeFilter);

	const recipientsSkeletonColumns = getTableSkeletonColumnsFromColumnDefs(columns, {
		name: { kind: 'mutedDash' },
		actions: { kind: 'empty' }
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
		recipientsTable.convex.setFilter('type', filter);
	}

	// Provide context for cell components
	setContext('onTogglePreference', togglePreference);
	setContext('onRemoveEmail', removeEmail);
	setContext('getRowSelection', () => recipientsTable.rowSelection);
	setContext('getRecipients', () =>
		recipientsTable.table.getRowModel().rows.map((row) => row.original)
	);

	const recipientsTableRenderConfig = $derived.by<BaseTableRenderConfig>(() => ({
		testIdPrefix: 'admin-settings',
		searchValue: tableParams.search,
		searchPlaceholder: $t('admin.users.search_placeholder'),
		onSearchChange: recipientsTable.convex.setSearch,
		pageIndex: recipientsTable.convex.pageIndex,
		pageCount: recipientsTable.convex.displayPageCount,
		pageSize: recipientsTable.convex.pageSize,
		pageSizeOptions: PAGE_SIZE_NUM_OPTIONS,
		canPreviousPage: recipientsTable.convex.canPreviousPage,
		canNextPage: recipientsTable.convex.canNextPage,
		onFirstPage: recipientsTable.convex.goFirst,
		onPreviousPage: recipientsTable.convex.goPrevious,
		onNextPage: recipientsTable.convex.goNext,
		onLastPage: recipientsTable.convex.goLast,
		onPageSizeChange: recipientsTable.convex.setPageSize,
		rowsPerPageLabel: $t('admin.users.rows_per_page'),
		selectionText: $t('admin.settings.selected', {
			selected: recipientsTable.selectedCount,
			total: recipientsTable.convex.displayTotalCount
		}),
		emptyKey: 'admin.settings.no_recipients',
		emptyTestId: 'recipients-empty',
		loadingLabelKey: 'aria.loading',
		skeletonColumns: recipientsSkeletonColumns,
		skeletonRowCount: recipientsTable.convex.skeletonRowCount,
		colspan: columns.length,
		testIds: {
			table: 'recipients-table',
			loading: 'admin-settings-loading',
			loadingRow: 'recipients-loading'
		}
	}));
</script>

<ConvexTanStackTable
	table={recipientsTable.table}
	config={recipientsTableRenderConfig}
	rowTestId={(row) => `recipient-row-${row.id}`}
>
	{#snippet toolbarFilters()}
		<DataTableFilters {typeFilter} onFilterChange={handleFilterChange} />
	{/snippet}

	{#snippet toolbarActions()}
		<AddEmailDialog bind:open={addEmailDialogOpen} />
	{/snippet}
</ConvexTanStackTable>

<ConfirmDeleteDialog />
