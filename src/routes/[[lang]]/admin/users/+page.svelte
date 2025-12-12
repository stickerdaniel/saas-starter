<script lang="ts">
	import {
		type ColumnFiltersState,
		type PaginationState,
		type RowSelectionState,
		type SortingState,
		type VisibilityState,
		getCoreRowModel,
		getFilteredRowModel,
		getPaginationRowModel,
		getSortedRowModel
	} from '@tanstack/table-core';
	import * as Table from '$lib/components/ui/table/index.js';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Skeleton } from '$lib/components/ui/skeleton/index.js';
	import { Checkbox } from '$lib/components/ui/checkbox/index.js';
	import SearchIcon from '@tabler/icons-svelte/icons/search';
	import DotsVerticalIcon from '@tabler/icons-svelte/icons/dots-vertical';
	import LayoutColumnsIcon from '@tabler/icons-svelte/icons/layout-columns';
	import ChevronDownIcon from '@tabler/icons-svelte/icons/chevron-down';
	import ChevronsLeftIcon from '@tabler/icons-svelte/icons/chevrons-left';
	import ChevronLeftIcon from '@tabler/icons-svelte/icons/chevron-left';
	import ChevronRightIcon from '@tabler/icons-svelte/icons/chevron-right';
	import ChevronsRightIcon from '@tabler/icons-svelte/icons/chevrons-right';
	import { T } from '@tolgee/svelte';
	import { useQuery, useConvexClient } from 'convex-svelte';
	import { api } from '$lib/convex/_generated/api.js';
	import { authClient } from '$lib/auth-client.js';
	import { toast } from 'svelte-sonner';
	import { setContext, getContext } from 'svelte';
	import type { PageData } from './$types';
	import { type UserRole, type AdminUserData } from '$lib/convex/admin/types';
	import { createSvelteTable, FlexRender } from '$lib/components/ui/data-table/index.js';
	import { columns } from './columns.js';
	import DataTableFilters from './data-table-filters.svelte';
	import type { ActionEvent } from './data-table-actions.svelte';

	let { data }: { data: PageData } = $props();

	const client = useConvexClient();

	// Search state (server-side filtering via Convex)
	let searchQuery = $state('');

	// TanStack Table state
	let pagination = $state<PaginationState>({ pageIndex: 0, pageSize: 10 });
	let sorting = $state<SortingState>([]);
	let columnFilters = $state<ColumnFiltersState>([]);
	let rowSelection = $state<RowSelectionState>({});
	let columnVisibility = $state<VisibilityState>({});

	// Dialog state
	let selectedUser = $state<AdminUserData | null>(null);
	let actionType = $state<'ban' | 'unban' | 'revoke' | null>(null);
	let banReason = $state('');
	let dialogOpen = $state(false);
	let roleDialogOpen = $state(false);
	let selectedRole = $state<UserRole>('user');

	// Fetch users with search - use a getter function to make search reactive
	const users = useQuery(api.admin.queries.listUsers, () => ({
		search: searchQuery || undefined
	}));

	// Provide context for action component
	setContext('currentUserId', data.viewer?._id);
	setContext('onUserAction', handleUserAction);

	// Get user count context from admin layout
	const userCountContext = getContext<{ get: () => number | null; set: (n: number) => void }>(
		'adminUserCount'
	);

	// Calculate skeleton rows: min(knownCount, pageSize) or pageSize if unknown
	const skeletonCount = $derived.by(() => {
		const known = userCountContext?.get();
		const pageSize = pagination.pageSize;
		if (known !== null && known !== undefined && known < pageSize) {
			return known;
		}
		return pageSize;
	});

	// Optimistic page count: use known user count when data is loading
	const optimisticPageCount = $derived.by(() => {
		// If we have real data, use the table's page count
		if (users.data !== undefined) {
			return table.getPageCount();
		}
		// Otherwise calculate from known user count
		const known = userCountContext?.get();
		if (known !== null && known !== undefined) {
			return Math.ceil(known / pagination.pageSize);
		}
		// Fallback to 1 if nothing is known
		return 1;
	});

	// Optimistic page row count for selection display (current page only)
	const optimisticPageRows = $derived.by(() => {
		// If we have real data, use the table's current page row count
		if (users.data !== undefined) {
			return table.getRowModel().rows.length;
		}
		// Otherwise use skeleton count (which is already min(known, pageSize))
		return skeletonCount;
	});

	// Update user count context when users data loads
	$effect(() => {
		if (users.data?.totalCount !== undefined) {
			userCountContext?.set(users.data.totalCount);
		}
	});

	// Create the table
	const table = createSvelteTable({
		get data() {
			return users.data?.users ?? [];
		},
		columns,
		state: {
			get pagination() {
				return pagination;
			},
			get sorting() {
				return sorting;
			},
			get columnVisibility() {
				return columnVisibility;
			},
			get rowSelection() {
				return rowSelection;
			},
			get columnFilters() {
				return columnFilters;
			}
		},
		getRowId: (row) => row.id,
		getCoreRowModel: getCoreRowModel(),
		getPaginationRowModel: getPaginationRowModel(),
		getSortedRowModel: getSortedRowModel(),
		getFilteredRowModel: getFilteredRowModel(),
		onPaginationChange: (updater) => {
			if (typeof updater === 'function') {
				pagination = updater(pagination);
			} else {
				pagination = updater;
			}
		},
		onSortingChange: (updater) => {
			if (typeof updater === 'function') {
				sorting = updater(sorting);
			} else {
				sorting = updater;
			}
		},
		onColumnFiltersChange: (updater) => {
			if (typeof updater === 'function') {
				columnFilters = updater(columnFilters);
			} else {
				columnFilters = updater;
			}
		},
		onColumnVisibilityChange: (updater) => {
			if (typeof updater === 'function') {
				columnVisibility = updater(columnVisibility);
			} else {
				columnVisibility = updater;
			}
		},
		onRowSelectionChange: (updater) => {
			if (typeof updater === 'function') {
				rowSelection = updater(rowSelection);
			} else {
				rowSelection = updater;
			}
		}
	});

	// Action handlers
	function handleUserAction(event: ActionEvent) {
		switch (event.type) {
			case 'impersonate':
				impersonateUser(event.userId);
				break;
			case 'openRoleDialog':
				openRoleDialog(event.user, event.role);
				break;
			case 'openBanDialog':
				openDialog(event.user, 'ban');
				break;
			case 'openUnbanDialog':
				openDialog(event.user, 'unban');
				break;
			case 'openRevokeDialog':
				openDialog(event.user, 'revoke');
				break;
		}
	}

	async function logAdminAction(
		action:
			| 'impersonate'
			| 'stop_impersonation'
			| 'ban_user'
			| 'unban_user'
			| 'revoke_sessions'
			| 'set_role',
		targetUserId: string,
		metadata?:
			| { reason: string }
			| { newRole: UserRole; previousRole: UserRole }
			| Record<string, never>
	) {
		await client.mutation(api.admin.mutations.logAdminAction, { action, targetUserId, metadata });
	}

	async function impersonateUser(userId: string) {
		try {
			const result = await authClient.admin.impersonateUser({ userId });
			if (result.error) {
				const message = result.error.message || 'Unknown error';
				toast.error(`Failed to impersonate user: ${message}`);
				console.error('Impersonation error:', result.error);
				return;
			}

			await logAdminAction('impersonate', userId, {});
			toast.success('Now impersonating user');

			// Navigate to root - avoids any caching issues
			window.location.href = '/';
		} catch (error) {
			const message = error instanceof Error ? error.message : 'Unknown error';
			toast.error(`Failed to impersonate user: ${message}`);
			console.error('Impersonation error:', error);
		}
	}

	async function banUser() {
		if (!selectedUser) return;

		try {
			const result = await authClient.admin.banUser({
				userId: selectedUser.id,
				banReason: banReason || 'Violated terms of service'
			});

			if (result.error) {
				const message = result.error.message || 'Unknown error';
				toast.error(`Failed to ban user: ${message}`);
				console.error('Ban error:', result.error);
				return;
			}

			await logAdminAction('ban_user', selectedUser.id, {
				reason: banReason || 'Violated terms of service'
			});

			toast.success('User has been banned');
			closeDialog();
		} catch (error) {
			const message = error instanceof Error ? error.message : 'Unknown error';
			toast.error(`Failed to ban user: ${message}`);
			console.error('Ban error:', error);
		}
	}

	async function unbanUser() {
		if (!selectedUser) return;

		try {
			const result = await authClient.admin.unbanUser({
				userId: selectedUser.id
			});

			if (result.error) {
				const message = result.error.message || 'Unknown error';
				toast.error(`Failed to unban user: ${message}`);
				console.error('Unban error:', result.error);
				return;
			}

			await logAdminAction('unban_user', selectedUser.id, {});
			toast.success('User has been unbanned');
			closeDialog();
		} catch (error) {
			const message = error instanceof Error ? error.message : 'Unknown error';
			toast.error(`Failed to unban user: ${message}`);
			console.error('Unban error:', error);
		}
	}

	async function revokeSessions() {
		if (!selectedUser) return;

		try {
			const result = await authClient.admin.revokeUserSessions({
				userId: selectedUser.id
			});

			if (result.error) {
				const message = result.error.message || 'Unknown error';
				toast.error(`Failed to revoke sessions: ${message}`);
				console.error('Revoke sessions error:', result.error);
				return;
			}

			await logAdminAction('revoke_sessions', selectedUser.id, {});
			toast.success('All sessions have been revoked');
			closeDialog();
		} catch (error) {
			const message = error instanceof Error ? error.message : 'Unknown error';
			toast.error(`Failed to revoke sessions: ${message}`);
			console.error('Revoke sessions error:', error);
		}
	}

	async function setUserRole() {
		if (!selectedUser) return;

		try {
			await client.mutation(api.admin.mutations.setUserRole, {
				userId: selectedUser.id,
				role: selectedRole
			});

			toast.success(`User role updated to ${selectedRole}`);
			closeRoleDialog();
		} catch (error) {
			const message = error instanceof Error ? error.message : 'Unknown error';
			toast.error(`Failed to set role: ${message}`);
			console.error('Set role error:', error);
		}
	}

	function openDialog(user: AdminUserData, type: 'ban' | 'unban' | 'revoke') {
		selectedUser = user;
		actionType = type;
		banReason = '';
		dialogOpen = true;
	}

	function closeDialog() {
		dialogOpen = false;
		selectedUser = null;
		actionType = null;
		banReason = '';
	}

	function openRoleDialog(user: AdminUserData, role: UserRole) {
		selectedUser = user;
		selectedRole = role;
		roleDialogOpen = true;
	}

	function closeRoleDialog() {
		roleDialogOpen = false;
		selectedUser = null;
		selectedRole = 'user';
	}
</script>

<div class="flex flex-col gap-6 px-4 lg:px-6">
	<!-- Header -->
	<div class="flex items-center justify-between">
		<h1 class="text-2xl font-bold"><T keyName="admin.users.title" /></h1>
		<div class="flex items-center gap-4">
			<div class="text-sm text-muted-foreground">
				{users.data?.totalCount ?? 0}
				<T keyName="admin.users.total" />
			</div>
		</div>
	</div>

	<!-- Controls: Search, Filters, Column Visibility -->
	<div class="flex flex-wrap items-center justify-between gap-4">
		<div class="flex flex-wrap items-center gap-4">
			<!-- Search -->
			<div class="relative w-full max-w-sm sm:w-auto">
				<SearchIcon class="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
				<Input
					type="search"
					placeholder="Search users..."
					class="w-full pl-10 sm:w-64"
					bind:value={searchQuery}
				/>
			</div>

			<!-- Filters -->
			<DataTableFilters {table} />
		</div>

		<!-- Column Visibility -->
		<DropdownMenu.Root>
			<DropdownMenu.Trigger>
				{#snippet child({ props })}
					<Button {...props} variant="outline" size="sm">
						<LayoutColumnsIcon class="mr-2 size-4" />
						Columns
						<ChevronDownIcon class="ml-2 size-4" />
					</Button>
				{/snippet}
			</DropdownMenu.Trigger>
			<DropdownMenu.Content align="end">
				{#each table.getAllColumns().filter((col) => col.getCanHide()) as column (column.id)}
					<DropdownMenu.CheckboxItem
						class="capitalize"
						checked={column.getIsVisible()}
						onCheckedChange={(value) => column.toggleVisibility(!!value)}
					>
						{column.id}
					</DropdownMenu.CheckboxItem>
				{/each}
			</DropdownMenu.Content>
		</DropdownMenu.Root>
	</div>

	<!-- Data Table -->
	<div class="rounded-md border">
		<Table.Root class="table-fixed">
			<Table.Header>
				{#each table.getHeaderGroups() as headerGroup (headerGroup.id)}
					<Table.Row>
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
				{#if users.data === undefined}
					<!-- Skeleton loading rows matching real row structure -->
					{#each Array(skeletonCount) as _, i (i)}
						<Table.Row>
							<!-- Checkbox: real disabled component -->
							<Table.Cell class="[&:has([role=checkbox])]:ps-3">
								<div class="flex items-center justify-center">
									<Checkbox disabled aria-label="Select row" />
								</div>
							</Table.Cell>
							<!-- Name: avatar (size-8 circle) + text -->
							<Table.Cell>
								<div class="flex items-center gap-2">
									<Skeleton class="size-8 rounded-full" />
									<span class="font-medium">
										<Skeleton class="h-4 w-20" />
									</span>
								</div>
							</Table.Cell>
							<!-- Email: plain text -->
							<Table.Cell>
								<Skeleton class="h-4 w-48" />
							</Table.Cell>
							<!-- Role: badge with py-1 text-xs = h-5 -->
							<Table.Cell>
								<Skeleton class="h-5 w-12 rounded-md" />
							</Table.Cell>
							<!-- Status: badge (longest is "Unverified" ~65px) -->
							<Table.Cell>
								<Skeleton class="h-5 w-[65px] rounded-md" />
							</Table.Cell>
							<!-- Created: date string -->
							<Table.Cell>
								<Skeleton class="h-4 w-20" />
							</Table.Cell>
							<!-- Actions: real disabled button -->
							<Table.Cell>
								<Button variant="ghost" size="icon" disabled>
									<DotsVerticalIcon class="size-4" />
									<span class="sr-only">Open menu</span>
								</Button>
							</Table.Cell>
						</Table.Row>
					{/each}
				{:else if table.getRowModel().rows.length === 0}
					<!-- No results -->
					<Table.Row>
						<Table.Cell colspan={columns.length} class="h-24 text-center text-muted-foreground">
							No results.
						</Table.Cell>
					</Table.Row>
				{:else}
					{#each table.getRowModel().rows as row (row.id)}
						<Table.Row data-state={row.getIsSelected() && 'selected'}>
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

	<!-- Footer: Selection Count & Pagination -->
	<div class="flex items-center justify-between px-2">
		<div class="hidden flex-1 text-sm text-muted-foreground lg:flex">
			{table.getFilteredSelectedRowModel().rows.length} of
			{optimisticPageRows} row(s) selected.
		</div>
		<div class="flex w-full items-center gap-8 lg:w-fit">
			<!-- Rows per page -->
			<div class="hidden items-center gap-2 lg:flex">
				<Label for="rows-per-page" class="text-sm font-medium">Rows per page</Label>
				<Select.Root
					type="single"
					value={`${table.getState().pagination.pageSize}`}
					onValueChange={(v) => table.setPageSize(Number(v))}
				>
					<Select.Trigger size="sm" class="w-20" id="rows-per-page">
						{table.getState().pagination.pageSize}
					</Select.Trigger>
					<Select.Content side="top">
						{#each [10, 20, 30, 40, 50] as pageSize (pageSize)}
							<Select.Item value={pageSize.toString()}>
								{pageSize}
							</Select.Item>
						{/each}
					</Select.Content>
				</Select.Root>
			</div>

			<!-- Page indicator -->
			<div class="flex w-fit items-center justify-center text-sm font-medium">
				Page {table.getState().pagination.pageIndex + 1} of
				{optimisticPageCount}
			</div>

			<!-- Pagination controls -->
			<div class="ml-auto flex items-center gap-2 lg:ml-0">
				<Button
					variant="outline"
					class="hidden h-8 w-8 p-0 lg:flex"
					onclick={() => table.setPageIndex(0)}
					disabled={!table.getCanPreviousPage()}
				>
					<span class="sr-only">Go to first page</span>
					<ChevronsLeftIcon />
				</Button>
				<Button
					variant="outline"
					class="size-8"
					size="icon"
					onclick={() => table.previousPage()}
					disabled={!table.getCanPreviousPage()}
				>
					<span class="sr-only">Go to previous page</span>
					<ChevronLeftIcon />
				</Button>
				<Button
					variant="outline"
					class="size-8"
					size="icon"
					onclick={() => table.nextPage()}
					disabled={!table.getCanNextPage()}
				>
					<span class="sr-only">Go to next page</span>
					<ChevronRightIcon />
				</Button>
				<Button
					variant="outline"
					class="hidden size-8 lg:flex"
					size="icon"
					onclick={() => table.setPageIndex(table.getPageCount() - 1)}
					disabled={!table.getCanNextPage()}
				>
					<span class="sr-only">Go to last page</span>
					<ChevronsRightIcon />
				</Button>
			</div>
		</div>
	</div>
</div>

<!-- Action Confirmation Dialog -->
<Dialog.Root bind:open={dialogOpen}>
	<Dialog.Content>
		<Dialog.Header>
			<Dialog.Title>
				{#if actionType === 'ban'}
					<T keyName="admin.dialog.ban_title" />
				{:else if actionType === 'unban'}
					<T keyName="admin.dialog.unban_title" />
				{:else if actionType === 'revoke'}
					<T keyName="admin.dialog.revoke_title" />
				{/if}
			</Dialog.Title>
			<Dialog.Description>
				{#if actionType === 'ban'}
					<T keyName="admin.dialog.ban_description" params={{ email: selectedUser?.email }} />
					<div class="mt-4">
						<Input placeholder="Ban reason (optional)" bind:value={banReason} />
					</div>
				{:else if actionType === 'unban'}
					<T keyName="admin.dialog.unban_description" params={{ email: selectedUser?.email }} />
				{:else if actionType === 'revoke'}
					<T keyName="admin.dialog.revoke_description" params={{ email: selectedUser?.email }} />
				{/if}
			</Dialog.Description>
		</Dialog.Header>
		<Dialog.Footer>
			<Button variant="outline" onclick={closeDialog}><T keyName="common.cancel" /></Button>
			<Button
				onclick={() => {
					if (actionType === 'ban') banUser();
					else if (actionType === 'unban') unbanUser();
					else if (actionType === 'revoke') revokeSessions();
				}}
				variant={actionType === 'ban' ? 'destructive' : 'default'}
			>
				<T keyName="common.confirm" />
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>

<!-- Role Change Confirmation Dialog -->
<Dialog.Root bind:open={roleDialogOpen}>
	<Dialog.Content>
		<Dialog.Header>
			<Dialog.Title>
				<T keyName="admin.dialog.set_role_title" />
			</Dialog.Title>
			<Dialog.Description>
				<T
					keyName="admin.dialog.set_role_description"
					params={{ email: selectedUser?.email, role: selectedRole }}
				/>
			</Dialog.Description>
		</Dialog.Header>
		<Dialog.Footer>
			<Button variant="outline" onclick={closeRoleDialog}><T keyName="common.cancel" /></Button>
			<Button onclick={setUserRole}>
				<T keyName="common.confirm" />
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
