<script lang="ts">
	import SEOHead from '$lib/components/SEOHead.svelte';
	import {
		type RowSelectionState,
		type SortingState,
		type VisibilityState,
		getCoreRowModel
	} from '@tanstack/table-core';
	import * as Table from '$lib/components/ui/table/index.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Skeleton } from '$lib/components/ui/skeleton/index.js';
	import { Checkbox } from '$lib/components/ui/checkbox/index.js';
	import SearchIcon from '@tabler/icons-svelte/icons/search';
	import DotsVerticalIcon from '@tabler/icons-svelte/icons/dots-vertical';
	import ChevronsLeftIcon from '@tabler/icons-svelte/icons/chevrons-left';
	import ChevronLeftIcon from '@tabler/icons-svelte/icons/chevron-left';
	import ChevronRightIcon from '@tabler/icons-svelte/icons/chevron-right';
	import ChevronsRightIcon from '@tabler/icons-svelte/icons/chevrons-right';
	import { T, getTranslate } from '@tolgee/svelte';

	const { t } = getTranslate();
	import { useQuery, useConvexClient } from 'convex-svelte';
	import { api } from '$lib/convex/_generated/api.js';
	import { authClient } from '$lib/auth-client.js';
	import { toast } from 'svelte-sonner';
	import { setContext } from 'svelte';
	import { adminCache } from '$lib/hooks/admin-cache.svelte';
	import type { PageData } from './$types';
	import { type UserRole, type AdminUserData } from '$lib/convex/admin/types';
	import { createSvelteTable, FlexRender } from '$lib/components/ui/data-table/index.js';
	import { columns } from './columns.js';
	import DataTableFilters from './data-table-filters.svelte';
	import type { ActionEvent } from './data-table-actions.svelte';
	import { Debounced } from 'runed';
	import { SvelteMap } from 'svelte/reactivity';

	let { data: _data }: { data: PageData } = $props();

	const client = useConvexClient();

	// Search state with debouncing
	let searchQuery = $state('');
	const debouncedSearch = new Debounced(() => searchQuery, 300);

	// Server-side pagination state
	let pageSize = $state(10);
	let pageIndex = $state(0);
	let cursors = new SvelteMap<number, string | null>([[0, null]]);

	// Local page cache for instant navigation
	type CachedPageData = {
		users: AdminUserData[];
		continueCursor: string | null;
		isDone: boolean;
	};
	let pageCache = new SvelteMap<number, CachedPageData>();

	// Track what cursor the current usersQuery.data was fetched with
	let queryCursorUsed = $state<string | null | undefined>(undefined);

	// Server-side filter state
	let roleFilter = $state<string | undefined>(undefined);
	let statusFilter = $state<'verified' | 'unverified' | 'banned' | undefined>(undefined);

	// TanStack Table state (only client-side concerns remain)
	let sorting = $state<SortingState>([]);
	let rowSelection = $state<RowSelectionState>({});
	let columnVisibility = $state<VisibilityState>({});

	// Dialog state
	let selectedUser = $state<AdminUserData | null>(null);
	let actionType = $state<'ban' | 'unban' | 'revoke' | null>(null);
	let banReason = $state('');
	let dialogOpen = $state(false);
	let roleDialogOpen = $state(false);
	let selectedRole = $state<UserRole>('user');
	let impersonationDialogOpen = $state(false);

	// Get current cursor for this page
	const currentCursor = $derived(cursors.get(pageIndex) ?? null);

	// Convert TanStack sorting state to backend sortBy format
	const sortBy = $derived.by(() => {
		if (sorting.length === 0) return undefined;
		const sort = sorting[0];
		// Map column IDs to backend field names
		const fieldMap: Record<string, 'createdAt' | 'email' | 'name'> = {
			createdAt: 'createdAt',
			email: 'email',
			name: 'name'
		};
		const field = fieldMap[sort.id];
		if (!field) return undefined;
		return {
			field,
			direction: sort.desc ? ('desc' as const) : ('asc' as const)
		};
	});

	// Query for current page with real cursor pagination
	const usersQuery = useQuery(api.admin.queries.listUsers, () => ({
		cursor: currentCursor ?? undefined,
		numItems: pageSize,
		search: debouncedSearch.current || undefined,
		roleFilter: roleFilter,
		statusFilter: statusFilter,
		sortBy: sortBy
	}));

	// Track the cursor that was used to fetch current query data
	$effect(() => {
		if (usersQuery.data && !usersQuery.isLoading) {
			queryCursorUsed = currentCursor;
		}
	});

	// Query for total count (for page count calculation)
	const countQuery = useQuery(api.admin.queries.getUserCount, () => ({
		search: debouncedSearch.current || undefined,
		roleFilter: roleFilter,
		statusFilter: statusFilter
	}));

	// Prefetch state - stores the next page data for instant navigation
	let prefetchedNextPage = $state<{
		cursor: string;
		data: typeof usersQuery.data;
	} | null>(null);

	// Track the next page cursor from current query
	const nextPageCursor = $derived(usersQuery.data?.continueCursor);

	// Prefetch query - runs when we have a next cursor
	// We use a separate query that updates based on the next cursor
	const prefetchArgs = $derived.by(() => {
		if (!nextPageCursor) return null;
		return {
			cursor: nextPageCursor,
			numItems: pageSize,
			search: debouncedSearch.current || undefined,
			roleFilter: roleFilter,
			statusFilter: statusFilter,
			sortBy: sortBy
		};
	});

	// Prefetch query - when no next cursor, use minimal args (numItems: 1)
	// This creates minimal overhead when we don't need to prefetch
	const prefetchQuery = useQuery(
		api.admin.queries.listUsers,
		() => prefetchArgs ?? { numItems: 1 } // Minimal fetch when no prefetch needed
	);

	// Store prefetched data when it arrives
	$effect(() => {
		if (prefetchArgs && prefetchQuery.data && nextPageCursor) {
			prefetchedNextPage = {
				cursor: nextPageCursor,
				data: prefetchQuery.data
			};
		}
	});

	// Clear prefetch when filters/search/sorting change
	$effect(() => {
		// This effect runs when any of these change
		void debouncedSearch.current;
		void roleFilter;
		void statusFilter;
		void sortBy;
		prefetchedNextPage = null;
	});

	// Cache pages when fetched from server
	$effect(() => {
		if (usersQuery.data && !usersQuery.isLoading) {
			// Only cache if data was fetched with the cursor expected for this page
			const expectedCursor = cursors.get(pageIndex) ?? null;
			if (queryCursorUsed === expectedCursor) {
				pageCache.set(pageIndex, {
					users: usersQuery.data.users,
					continueCursor: usersQuery.data.continueCursor,
					isDone: usersQuery.data.isDone
				});
				pageCache = pageCache; // Trigger reactivity
			}
		}
	});

	// Also cache prefetched pages
	$effect(() => {
		if (prefetchedNextPage?.data && prefetchedNextPage.cursor) {
			// Find which page this prefetch belongs to by matching cursor
			for (const [index, cursor] of cursors.entries()) {
				if (cursor === prefetchedNextPage.cursor && !pageCache.has(index)) {
					pageCache.set(index, {
						users: prefetchedNextPage.data.users,
						continueCursor: prefetchedNextPage.data.continueCursor,
						isDone: prefetchedNextPage.data.isDone
					});
					pageCache = pageCache;
					break;
				}
			}
		}
	});

	// Get current page data - from cache (instant) or query (loading)
	const currentPageData = $derived.by(() => {
		const cached = pageCache.get(pageIndex);
		if (cached) return cached;
		return usersQuery.data;
	});

	// Provide context for action component (currentUserId is set by admin layout)
	setContext('onUserAction', handleUserAction);

	// Calculate skeleton rows: min(knownCount - offset, pageSize) or pageSize if unknown
	const skeletonCount = $derived.by(() => {
		if (adminCache.userCount.current !== null) {
			const remaining = adminCache.userCount.current - pageIndex * pageSize;
			return Math.min(Math.max(remaining, 0), pageSize);
		}
		return pageSize;
	});

	// Page count from server
	const pageCount = $derived.by(() => {
		if (countQuery.data !== undefined) {
			return Math.ceil(countQuery.data / pageSize);
		}
		// Fallback to cached count
		if (adminCache.userCount.current !== null) {
			return Math.ceil(adminCache.userCount.current / pageSize);
		}
		return 1;
	});

	// Update user count cache when count data loads
	$effect(() => {
		if (countQuery.data !== undefined) {
			adminCache.userCount.current = countQuery.data;
		}
	});

	// Store next cursor when we get it
	$effect(() => {
		if (usersQuery.data?.continueCursor) {
			cursors.set(pageIndex + 1, usersQuery.data.continueCursor);
			cursors = cursors; // Trigger reactivity
		}
	});

	// Reset pagination when filters/search/sorting change
	let previousSearch = '';
	let previousRoleFilter: string | undefined = undefined;
	let previousStatusFilter: 'verified' | 'unverified' | 'banned' | undefined = undefined;
	let previousSortBy: typeof sortBy = undefined;

	$effect(() => {
		const currentSearch = debouncedSearch.current;
		const currentSortBy = sortBy;
		if (
			currentSearch !== previousSearch ||
			roleFilter !== previousRoleFilter ||
			statusFilter !== previousStatusFilter ||
			JSON.stringify(currentSortBy) !== JSON.stringify(previousSortBy)
		) {
			previousSearch = currentSearch;
			previousRoleFilter = roleFilter;
			previousStatusFilter = statusFilter;
			previousSortBy = currentSortBy;

			// Reset to page 0 and clear caches
			pageIndex = 0;
			cursors = new SvelteMap([[0, null]]);
			pageCache = new SvelteMap();
		}
	});

	// Navigation helpers
	const canPreviousPage = $derived(pageIndex > 0);
	const canNextPage = $derived.by(() => {
		const data = currentPageData;
		// Must have data loaded
		if (!data) return false;
		// Must not be done (no more pages)
		if (data.isDone) return false;
		// Must have a next cursor
		if (!data.continueCursor) return false;
		// Must not be at or past page count
		if (pageCount > 0 && pageIndex >= pageCount - 1) return false;
		return true;
	});

	function goToFirstPage() {
		pageIndex = 0;
	}

	function goToPreviousPage() {
		if (canPreviousPage) {
			pageIndex = pageIndex - 1;
		}
	}

	function goToNextPage() {
		if (canNextPage && usersQuery.data?.continueCursor) {
			// Store the cursor for the next page before navigating
			cursors.set(pageIndex + 1, usersQuery.data.continueCursor);
			cursors = cursors;
			pageIndex = pageIndex + 1;
		}
	}

	function goToLastPage() {
		// With cursor pagination, we can't easily jump to last page
		// We'd need to know all cursors. For now, disabled.
	}

	function handlePageSizeChange(newSize: number) {
		pageSize = newSize;
		pageIndex = 0;
		cursors = new SvelteMap([[0, null]]);
		pageCache = new SvelteMap();
		prefetchedNextPage = null; // Clear prefetch cache too
	}

	// Filter change handler (called from DataTableFilters)
	function handleFilterChange(filters: {
		role: string | undefined;
		status: 'verified' | 'unverified' | 'banned' | undefined;
	}) {
		roleFilter = filters.role;
		statusFilter = filters.status;
	}

	// Create the table (manual pagination mode)
	const table = createSvelteTable({
		get data() {
			return currentPageData?.users ?? [];
		},
		columns,
		state: {
			get pagination() {
				return { pageIndex, pageSize };
			},
			get sorting() {
				return sorting;
			},
			get columnVisibility() {
				return columnVisibility;
			},
			get rowSelection() {
				return rowSelection;
			}
		},
		manualPagination: true,
		manualFiltering: true,
		manualSorting: true,
		get pageCount() {
			return pageCount;
		},
		getRowId: (row) => row.id,
		getCoreRowModel: getCoreRowModel(),
		onSortingChange: (updater) => {
			if (typeof updater === 'function') {
				sorting = updater(sorting);
			} else {
				sorting = updater;
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
		await client.mutation(api.admin.mutations.createAuditLog, { action, targetUserId, metadata });
	}

	async function impersonateUser(userId: string) {
		try {
			const result = await authClient.admin.impersonateUser({ userId });
			if (result.error) {
				const message = result.error.message || 'Unknown error';
				toast.error($t('admin.users.toast.impersonate_failed', { message }));
				console.error('Impersonation error:', result.error);
				return;
			}

			await logAdminAction('impersonate', userId, {});
			impersonationDialogOpen = true;
		} catch (error) {
			const message = error instanceof Error ? error.message : 'Unknown error';
			toast.error($t('admin.users.toast.impersonate_failed', { message }));
			console.error('Impersonation error:', error);
		}
	}

	async function banUser() {
		if (!selectedUser) return;

		const defaultBanReason = $t('admin.users.ban_reason.default');
		try {
			const result = await authClient.admin.banUser({
				userId: selectedUser.id,
				banReason: banReason || defaultBanReason
			});

			if (result.error) {
				const message = result.error.message || 'Unknown error';
				toast.error($t('admin.users.toast.ban_failed', { message }));
				console.error('Ban error:', result.error);
				return;
			}

			await logAdminAction('ban_user', selectedUser.id, {
				reason: banReason || defaultBanReason
			});

			toast.success($t('admin.users.toast.banned'));
			closeDialog();
		} catch (error) {
			const message = error instanceof Error ? error.message : 'Unknown error';
			toast.error($t('admin.users.toast.ban_failed', { message }));
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
				toast.error($t('admin.users.toast.unban_failed', { message }));
				console.error('Unban error:', result.error);
				return;
			}

			await logAdminAction('unban_user', selectedUser.id, {});
			toast.success($t('admin.users.toast.unbanned'));
			closeDialog();
		} catch (error) {
			const message = error instanceof Error ? error.message : 'Unknown error';
			toast.error($t('admin.users.toast.unban_failed', { message }));
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
				toast.error($t('admin.users.toast.revoke_failed', { message }));
				console.error('Revoke sessions error:', result.error);
				return;
			}

			await logAdminAction('revoke_sessions', selectedUser.id, {});
			toast.success($t('admin.users.toast.revoked'));
			closeDialog();
		} catch (error) {
			const message = error instanceof Error ? error.message : 'Unknown error';
			toast.error($t('admin.users.toast.revoke_failed', { message }));
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

			toast.success($t('admin.users.toast.role_updated', { role: selectedRole }));
			closeRoleDialog();
		} catch (error) {
			const message = error instanceof Error ? error.message : 'Unknown error';
			toast.error($t('admin.users.toast.role_failed', { message }));
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

<SEOHead title={$t('meta.admin.users.title')} description={$t('meta.admin.users.description')} />

<div class="flex flex-col gap-6 px-4 lg:px-6 xl:px-8 2xl:px-16">
	<!-- Header -->
	<div class="flex items-center justify-between">
		<h1 class="text-2xl font-bold"><T keyName="admin.users.title" /></h1>
	</div>

	<!-- Controls: Search, Filters, Column Visibility -->
	<div class="flex flex-wrap items-center justify-between gap-4">
		<div class="flex flex-wrap items-center gap-4">
			<!-- Search -->
			<div class="relative w-full max-w-sm sm:w-auto">
				<SearchIcon class="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
				<Input
					type="search"
					placeholder={$t('admin.users.search_placeholder')}
					class="w-full pl-10 sm:w-64"
					bind:value={searchQuery}
				/>
			</div>

			<!-- Filters -->
			<DataTableFilters {roleFilter} {statusFilter} onFilterChange={handleFilterChange} />
		</div>

		<!-- Column Visibility (commented out for now, may be useful later)
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
		-->
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
				{#if currentPageData === undefined && skeletonCount > 0}
					<!-- Skeleton loading rows matching real row structure -->
					{#each Array(skeletonCount) as _, i (i)}
						<Table.Row>
							<!-- Checkbox: real disabled component -->
							<Table.Cell class="[&:has([role=checkbox])]:ps-3">
								<div class="flex items-center justify-center">
									<Checkbox disabled aria-label={$t('admin.users.select_row')} />
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
									<span class="sr-only"><T keyName="admin.users.menu_open" /></span>
								</Button>
							</Table.Cell>
						</Table.Row>
					{/each}
				{:else if table.getRowModel().rows.length === 0 || (currentPageData === undefined && skeletonCount === 0)}
					<!-- No results (shown immediately when cache=0, or after load completes with 0 items) -->
					<Table.Row>
						<Table.Cell
							colspan={columns.length}
							class="h-24 text-center text-muted-foreground hover:!bg-transparent"
						>
							<T keyName="admin.users.no_results" />
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
			<T
				keyName="admin.users.selected"
				params={{
					selected: Object.keys(rowSelection).length,
					total: countQuery.data ?? adminCache.userCount.current ?? 0
				}}
			/>
		</div>
		<div class="flex w-full items-center gap-8 lg:w-fit">
			<!-- Rows per page -->
			<div class="hidden items-center gap-2 lg:flex">
				<Label for="rows-per-page" class="text-sm font-medium"
					><T keyName="admin.users.rows_per_page" /></Label
				>
				<Select.Root
					type="single"
					value={`${pageSize}`}
					onValueChange={(v) => handlePageSizeChange(Number(v))}
				>
					<Select.Trigger size="sm" class="w-20" id="rows-per-page">
						{pageSize}
					</Select.Trigger>
					<Select.Content side="top">
						{#each [1, 10, 20, 30, 40, 50] as size (size)}
							<Select.Item value={size.toString()}>
								{size}
							</Select.Item>
						{/each}
					</Select.Content>
				</Select.Root>
			</div>

			<!-- Page indicator -->
			<div class="flex w-fit items-center justify-center text-sm font-medium">
				<T
					keyName="admin.users.page_indicator"
					params={{
						current: pageIndex + 1,
						total: pageCount
					}}
				/>
			</div>

			<!-- Pagination controls -->
			<div class="ml-auto flex items-center gap-2 lg:ml-0">
				<Button
					variant="outline"
					class="hidden h-8 w-8 p-0 lg:flex"
					onclick={goToFirstPage}
					disabled={!canPreviousPage}
				>
					<span class="sr-only"><T keyName="admin.users.pagination.first" /></span>
					<ChevronsLeftIcon />
				</Button>
				<Button
					variant="outline"
					class="size-8"
					size="icon"
					onclick={goToPreviousPage}
					disabled={!canPreviousPage}
				>
					<span class="sr-only"><T keyName="admin.users.pagination.previous" /></span>
					<ChevronLeftIcon />
				</Button>
				<Button
					variant="outline"
					class="size-8"
					size="icon"
					onclick={goToNextPage}
					disabled={!canNextPage}
				>
					<span class="sr-only"><T keyName="admin.users.pagination.next" /></span>
					<ChevronRightIcon />
				</Button>
				<Button
					variant="outline"
					class="hidden size-8 lg:flex"
					size="icon"
					onclick={goToLastPage}
					disabled={true}
				>
					<span class="sr-only"><T keyName="admin.users.pagination.last" /></span>
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
						<Input placeholder={$t('admin.dialog.ban_reason_placeholder')} bind:value={banReason} />
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

<!-- Impersonation Active Dialog -->
<Dialog.Root bind:open={impersonationDialogOpen}>
	<Dialog.Content>
		<Dialog.Header>
			<Dialog.Title>
				<T keyName="admin.dialog.impersonation_active_title" />
			</Dialog.Title>
			<Dialog.Description>
				<T keyName="admin.dialog.impersonation_active_description" />
			</Dialog.Description>
		</Dialog.Header>
		<Dialog.Footer>
			<Button onclick={() => (impersonationDialogOpen = false)}>OK</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
