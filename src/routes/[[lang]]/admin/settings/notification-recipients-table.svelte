<script lang="ts">
	import { getCoreRowModel, type RowSelectionState } from '@tanstack/table-core';
	import * as Table from '$lib/components/ui/table/index.js';
	import { Skeleton } from '$lib/components/ui/skeleton/index.js';
	import { Checkbox } from '$lib/components/ui/checkbox/index.js';

	import { T, getTranslate } from '@tolgee/svelte';
	import { useQuery, useConvexClient } from 'convex-svelte';
	import { api } from '$lib/convex/_generated/api.js';
	import { setContext } from 'svelte';
	import { createSvelteTable, FlexRender } from '$lib/components/ui/data-table/index.js';
	import { columns } from './columns.js';
	import type { NotificationRecipient } from '$lib/convex/admin/notificationPreferences/queries';
	import { adminCache } from '$lib/hooks/admin-cache.svelte';
	import AddEmailDialog from './add-email-dialog.svelte';
	import DataTableFilters from './data-table-filters.svelte';
	import { ConfirmDeleteDialog } from '$lib/components/ui/confirm-delete-dialog';

	const { t } = getTranslate();
	const client = useConvexClient();

	// Query for notification recipients
	const recipientsQuery = useQuery(
		api.admin.notificationPreferences.queries.listNotificationRecipients,
		{}
	);

	// Track pending updates for optimistic UI
	let pendingUpdates = $state<Map<string, Record<string, boolean>>>(new Map());

	// Filter state
	let typeFilter = $state<'all' | 'admin' | 'custom'>('all');

	// Row selection state (for temp checkbox column)
	let rowSelection = $state<RowSelectionState>({});

	// Derive recipients with pending updates applied
	const recipientsWithUpdates: NotificationRecipient[] = $derived.by(() => {
		if (!recipientsQuery.data) return [];
		return recipientsQuery.data.map((r: NotificationRecipient) => {
			const pending = pendingUpdates.get(r.email);
			if (pending) {
				return { ...r, ...pending };
			}
			return r;
		});
	});

	// Apply client-side type filter
	const recipients: NotificationRecipient[] = $derived.by(() => {
		if (typeFilter === 'all') return recipientsWithUpdates;
		if (typeFilter === 'admin') return recipientsWithUpdates.filter((r) => r.isAdminUser);
		return recipientsWithUpdates.filter((r) => !r.isAdminUser);
	});

	// Total count (unfiltered) for footer - falls back to cache during loading
	const totalCount = $derived(
		recipientsQuery.data?.length ?? adminCache.recipientCount.current ?? 0
	);

	const isLoading = $derived(recipientsQuery.isLoading);

	async function togglePreference(
		email: string,
		field: 'notifyNewSupportTickets' | 'notifyUserReplies' | 'notifyNewSignups',
		currentValue: boolean
	) {
		const newValue = !currentValue;

		// Optimistic update
		const existing = pendingUpdates.get(email) ?? {};
		pendingUpdates.set(email, { ...existing, [field]: newValue });
		pendingUpdates = new Map(pendingUpdates);

		try {
			await client.mutation(api.admin.notificationPreferences.mutations.updatePreference, {
				email,
				field,
				value: newValue
			});
		} catch (error) {
			// Revert optimistic update
			const current = pendingUpdates.get(email);
			if (current) {
				delete current[field];
				if (Object.keys(current).length === 0) {
					pendingUpdates.delete(email);
				}
			}
			pendingUpdates = new Map(pendingUpdates);
			throw error;
		}
	}

	// Remove a custom email - returns promise for confirmDelete
	async function removeEmail(email: string) {
		await client.mutation(api.admin.notificationPreferences.mutations.removeCustomEmail, {
			email
		});
	}

	// Provide context for cell components
	setContext('onTogglePreference', togglePreference);
	setContext('onRemoveEmail', removeEmail);
	// Provide selection state and recipients for bulk operations
	setContext('getRowSelection', () => rowSelection);
	setContext('getRecipients', () => recipientsWithUpdates);

	// Add email dialog state
	let addEmailDialogOpen = $state(false);

	// Handle filter change
	function handleFilterChange(filter: 'all' | 'admin' | 'custom') {
		typeFilter = filter;
	}

	// Create the table
	const table = createSvelteTable({
		get data() {
			return recipients;
		},
		columns,
		state: {
			get rowSelection() {
				return rowSelection;
			}
		},
		getRowId: (row) => row.email,
		getCoreRowModel: getCoreRowModel(),
		onRowSelectionChange: (updater) => {
			if (typeof updater === 'function') {
				rowSelection = updater(rowSelection);
			} else {
				rowSelection = updater;
			}
		}
	});

	// Smart skeleton count: use cached count or default to 1
	const skeletonCount = $derived(adminCache.recipientCount.current ?? 1);

	// Cache recipient count when data loads
	$effect(() => {
		if (recipientsQuery.data) {
			adminCache.recipientCount.current = recipientsQuery.data.length;
		}
	});
</script>

<div class="flex flex-col gap-6" data-testid="recipients-table">
	<!-- Controls: Filters + Add Email Button -->
	<div class="flex flex-wrap items-center justify-between gap-4">
		<DataTableFilters {typeFilter} onFilterChange={handleFilterChange} />
		<AddEmailDialog bind:open={addEmailDialogOpen} />
	</div>

	<!-- Data Table -->
	<div class="overflow-hidden rounded-md border">
		<Table.Root class="table-fixed">
			<Table.Header class="sticky top-0 z-10 bg-muted">
				{#each table.getHeaderGroups() as headerGroup (headerGroup.id)}
					<Table.Row class="hover:[&>th]:bg-muted">
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
				{#if isLoading}
					<!-- Skeleton loading rows matching real row structure exactly -->
					{#each Array(skeletonCount) as _, i (i)}
						<Table.Row data-testid="recipients-loading">
							<!-- Checkbox: matches DataTableCheckbox -->
							<Table.Cell class="[&:has([role=checkbox])]:ps-3">
								<div class="flex items-center justify-center">
									<Checkbox disabled aria-label="Loading" />
								</div>
							</Table.Cell>
							<!-- Email -->
							<Table.Cell>
								<Skeleton class="h-4 w-40" />
							</Table.Cell>
							<!-- Name: show dash like actual empty state -->
							<Table.Cell>
								<span class="text-muted-foreground/50">-</span>
							</Table.Cell>
							<!-- Type: badge skeleton -->
							<Table.Cell>
								<Skeleton class="h-[22px] w-14 rounded-md" />
							</Table.Cell>
							<!-- New Tickets -->
							<Table.Cell class="[&:has([role=checkbox])]:ps-3">
								<div class="flex items-center justify-center">
									<Checkbox disabled aria-label="Loading" />
								</div>
							</Table.Cell>
							<!-- User Replies -->
							<Table.Cell class="[&:has([role=checkbox])]:ps-3">
								<div class="flex items-center justify-center">
									<Checkbox disabled aria-label="Loading" />
								</div>
							</Table.Cell>
							<!-- New Signups -->
							<Table.Cell class="[&:has([role=checkbox])]:ps-3">
								<div class="flex items-center justify-center">
									<Checkbox disabled aria-label="Loading" />
								</div>
							</Table.Cell>
							<!-- Actions: invisible placeholder for consistent row height -->
							<Table.Cell>
								<div class="h-8 w-8" aria-hidden="true"></div>
							</Table.Cell>
						</Table.Row>
					{/each}
				{:else if table.getRowModel().rows.length === 0}
					<!-- No results -->
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
	</div>

	<!-- Footer: Selection Count -->
	<div class="flex items-center px-2">
		<div class="text-sm text-muted-foreground">
			<T
				keyName="admin.settings.selected"
				params={{ selected: Object.keys(rowSelection).length, total: totalCount }}
			/>
		</div>
	</div>
</div>

<!-- Global Confirm Delete Dialog -->
<ConfirmDeleteDialog />
