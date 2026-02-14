<script lang="ts">
	import SEOHead from '$lib/components/SEOHead.svelte';
	import * as v from 'valibot';
	import {
		type RowSelectionState,
		type SortingState,
		type VisibilityState,
		getCoreRowModel
	} from '@tanstack/table-core';
	import * as Table from '$lib/components/ui/table/index.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import * as Field from '$lib/components/ui/field/index.js';
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
	import { setContext, untrack } from 'svelte';
	import { adminCache } from '$lib/hooks/admin-cache.svelte';
	import { useSearchParams } from 'runed/kit';
	import type { PageData } from './$types';
	import { type UserRole, type AdminUserData } from '$lib/convex/admin/types';
	import { createSvelteTable, FlexRender } from '$lib/components/ui/data-table/index.js';
	import { columns } from './columns.js';
	import DataTableFilters from './data-table-filters.svelte';
	import type { ActionEvent } from './data-table-actions.svelte';
	import { Debounced } from 'runed';

	let { data: _data }: { data: PageData } = $props();

	const client = useConvexClient();

	type UserStatusFilter = 'verified' | 'unverified' | 'banned';
	type SortQueryField = 'created_at' | 'email' | 'name' | 'role';
	type SortDirection = 'asc' | 'desc';
	type UsersTableSort = `${SortQueryField}.${SortDirection}`;

	const SORT_COLUMN_TO_QUERY_FIELD = {
		createdAt: 'created_at',
		email: 'email',
		name: 'name',
		role: 'role'
	} as const;
	const SORT_QUERY_FIELD_TO_COLUMN = {
		created_at: 'createdAt',
		email: 'email',
		name: 'name',
		role: 'role'
	} as const;

	const PAGE_SIZE_OPTIONS = ['1', '10', '20', '30', '40', '50'] as const;

	const usersTableParamsSchema = v.object({
		search: v.optional(v.fallback(v.string(), ''), ''),
		role: v.optional(v.fallback(v.picklist(['all', 'admin', 'user']), 'all'), 'all'),
		status: v.optional(
			v.fallback(v.picklist(['all', 'verified', 'unverified', 'banned']), 'all'),
			'all'
		),
		sort: v.optional(v.fallback(v.string(), ''), ''),
		page: v.optional(v.fallback(v.string(), '1'), '1'),
		page_size: v.optional(v.fallback(v.picklist(PAGE_SIZE_OPTIONS), '10'), '10'),
		cursor: v.optional(v.fallback(v.string(), ''), '')
	});

	const tableParams = useSearchParams(usersTableParamsSchema, {
		pushHistory: true,
		noScroll: true
	});

	function parseSortParam(sort: string): SortingState {
		if (!sort) return [];
		const [field, direction] = sort.split(/[.:]/u);
		if (direction !== 'asc' && direction !== 'desc') return [];
		const columnId = SORT_QUERY_FIELD_TO_COLUMN[field as SortQueryField];
		if (!columnId) return [];
		return [{ id: columnId, desc: direction === 'desc' }];
	}

	function serializeSortParam(nextSorting: SortingState): UsersTableSort | '' {
		if (nextSorting.length === 0) return '';
		const primarySort = nextSorting[0];
		const field =
			SORT_COLUMN_TO_QUERY_FIELD[primarySort.id as keyof typeof SORT_COLUMN_TO_QUERY_FIELD];
		if (!field) return '';
		const direction: SortDirection = primarySort.desc ? 'desc' : 'asc';
		return `${field}.${direction}`;
	}

	function parsePageIndex(page: string): number {
		const parsed = Number.parseInt(page, 10);
		if (!Number.isFinite(parsed) || parsed < 1) return 0;
		return parsed - 1;
	}

	function handleSearchInput(event: Event) {
		tableParams.search = (event.currentTarget as HTMLInputElement).value;
	}

	// URL-backed table state
	const debouncedSearch = new Debounced(() => tableParams.search, 300);
	const pageSize = $derived(Number.parseInt(tableParams.page_size, 10));
	const pageIndex = $derived(parsePageIndex(tableParams.page));
	const roleFilter = $derived.by(() => (tableParams.role === 'all' ? undefined : tableParams.role));
	const statusFilter = $derived.by(() =>
		tableParams.status === 'all' ? undefined : (tableParams.status as UserStatusFilter)
	);
	const sorting = $derived(parseSortParam(tableParams.sort));

	// Server-side pagination state
	let pageCursors = $state<(string | null)[]>([null]);
	type CachedPageData = {
		users: AdminUserData[];
		continueCursor: string | null;
		isDone: boolean;
	};
	let pageCache = $state<Record<number, CachedPageData>>({});

	// TanStack Table state (only client-side concerns remain)
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
	const currentCursor = $derived.by(() => {
		if (pageIndex === 0) return null;
		return pageCursors[pageIndex] ?? (tableParams.cursor || null);
	});

	// Convert TanStack sorting state to backend sortBy format
	const sortBy = $derived.by(() => {
		if (sorting.length === 0) return undefined;
		const sort = sorting[0];
		// Map column IDs to backend field names
		const fieldMap: Record<string, 'createdAt' | 'email' | 'name' | 'role'> = {
			createdAt: 'createdAt',
			email: 'email',
			name: 'name',
			role: 'role'
		};
		const field = fieldMap[sort.id];
		if (!field) return undefined;
		return {
			field,
			direction: sort.desc ? ('desc' as const) : ('asc' as const)
		};
	});

	const buildUsersQueryArgs = (cursor: string | null | undefined) => ({
		cursor: cursor ?? undefined,
		numItems: pageSize,
		search: debouncedSearch.current || undefined,
		roleFilter: roleFilter,
		statusFilter: statusFilter,
		sortBy: sortBy
	});

	// Query for current page with real cursor pagination
	const usersQuery = useQuery(api.admin.queries.listUsers, () =>
		buildUsersQueryArgs(currentCursor)
	);

	// Query for total count (for page count calculation)
	const countQuery = useQuery(api.admin.queries.getUserCount, () => ({
		search: debouncedSearch.current || undefined,
		roleFilter: roleFilter,
		statusFilter: statusFilter
	}));

	const currentPageData = $derived(pageCache[pageIndex] ?? usersQuery.data);

	$effect(() => {
		if (pageIndex === 0) return;
		if (pageCursors[pageIndex]) return;
		if (tableParams.cursor) {
			const nextCursors = pageCursors.slice(0, pageIndex + 1);
			nextCursors[pageIndex] = tableParams.cursor;
			pageCursors = nextCursors;
			return;
		}

		// Invalid deep-link state (page > 1 without a cursor): reset to first page.
		tableParams.page = '1';
		tableParams.cursor = '';
		pageCursors = [null];
		pageCache = {};
	});

	function cachePage(index: number, data: CachedPageData | undefined) {
		if (!data) return;
		const existing = untrack(() => pageCache[index]);
		if (
			existing &&
			existing.continueCursor === data.continueCursor &&
			existing.isDone === data.isDone &&
			existing.users.length === data.users.length
		) {
			return;
		}
		pageCache[index] = data;
	}

	function cacheCurrentPage() {
		const data = currentPageData;
		if (!data) return;
		cachePage(pageIndex, {
			users: data.users,
			continueCursor: data.continueCursor,
			isDone: data.isDone
		});
	}

	// Cache current page after data arrives so previous navigation is instant.
	$effect(() => {
		if (!usersQuery.data) return;
		cachePage(pageIndex, {
			users: usersQuery.data.users,
			continueCursor: usersQuery.data.continueCursor,
			isDone: usersQuery.data.isDone
		});
	});

	const nextPrefetch = $derived.by(() => {
		const data = currentPageData;
		if (!data || data.isDone || !data.continueCursor) return null;
		const index = pageIndex + 1;
		if (pageCache[index]) return null;
		return {
			index,
			args: buildUsersQueryArgs(data.continueCursor)
		};
	});

	const nextPrefetchQuery = useQuery(
		api.admin.queries.listUsers,
		() => nextPrefetch?.args ?? 'skip'
	);

	$effect(() => {
		if (!nextPrefetch || !nextPrefetchQuery.data) return;
		cachePage(nextPrefetch.index, {
			users: nextPrefetchQuery.data.users,
			continueCursor: nextPrefetchQuery.data.continueCursor,
			isDone: nextPrefetchQuery.data.isDone
		});
	});

	const previousPrefetch = $derived.by(() => {
		const index = pageIndex - 1;
		if (index < 0 || pageCache[index]) return null;
		const cursor = pageCursors[index];
		if (cursor === undefined) return null;
		return {
			index,
			args: buildUsersQueryArgs(cursor)
		};
	});

	const previousPrefetchQuery = useQuery(
		api.admin.queries.listUsers,
		() => previousPrefetch?.args ?? 'skip'
	);

	$effect(() => {
		if (!previousPrefetch || !previousPrefetchQuery.data) return;
		cachePage(previousPrefetch.index, {
			users: previousPrefetchQuery.data.users,
			continueCursor: previousPrefetchQuery.data.continueCursor,
			isDone: previousPrefetchQuery.data.isDone
		});
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

	// Reset pagination when filters/search/sorting change
	let hasInitializedPaginationReset = false;
	let previousSearch = '';
	let previousRoleFilter: string | undefined = undefined;
	let previousStatusFilter: UserStatusFilter | undefined = undefined;
	let previousSortBy: typeof sortBy = undefined;

	$effect(() => {
		const currentSearch = debouncedSearch.current;
		const currentSortBy = sortBy;
		if (!hasInitializedPaginationReset) {
			hasInitializedPaginationReset = true;
			previousSearch = currentSearch;
			previousRoleFilter = roleFilter;
			previousStatusFilter = statusFilter;
			previousSortBy = currentSortBy;
			return;
		}

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

			// Reset cursor stack when backend query args change.
			tableParams.page = '1';
			tableParams.cursor = '';
			pageCursors = [null];
			pageCache = {};
		}
	});

	// Navigation helpers
	const canPreviousPage = $derived.by(() => {
		if (pageIndex <= 0) return false;
		if (pageIndex === 1) return true;
		return pageCursors[pageIndex - 1] !== undefined;
	});
	const canNextPage = $derived.by(() => {
		const data = currentPageData;
		// Must have data loaded
		if (!data) return false;
		// Must not be done (no more pages)
		if (data.isDone) return false;
		// Must have a next cursor
		if (!data.continueCursor) return false;
		return true;
	});

	function goToFirstPage() {
		cacheCurrentPage();
		tableParams.page = '1';
		tableParams.cursor = '';
	}

	function goToPreviousPage() {
		if (!canPreviousPage) return;
		cacheCurrentPage();
		const previousIndex = pageIndex - 1;
		const previousCursor = previousIndex === 0 ? null : pageCursors[previousIndex];
		if (previousIndex > 0 && previousCursor === undefined) return;
		tableParams.page = `${previousIndex + 1}`;
		tableParams.cursor = previousCursor ?? '';
	}

	function goToNextPage() {
		const nextCursor = currentPageData?.continueCursor;
		if (canNextPage && nextCursor) {
			cacheCurrentPage();
			const nextIndex = pageIndex + 1;
			const nextCursors = pageCursors.slice(0, nextIndex);
			nextCursors[nextIndex] = nextCursor;
			pageCursors = nextCursors;
			tableParams.page = `${nextIndex + 1}`;
			tableParams.cursor = nextCursor;
		}
	}

	function goToLastPage() {
		// With cursor pagination, we can't easily jump to last page
		// We'd need to know all cursors. For now, disabled.
	}

	function handlePageSizeChange(newSize: number) {
		if (newSize === pageSize) return;
		if (!PAGE_SIZE_OPTIONS.includes(`${newSize}` as (typeof PAGE_SIZE_OPTIONS)[number])) return;
		tableParams.page_size = `${newSize}` as (typeof PAGE_SIZE_OPTIONS)[number];
		tableParams.page = '1';
		tableParams.cursor = '';
		pageCursors = [null];
		pageCache = {};
	}

	// Filter change handler (called from DataTableFilters)
	function handleFilterChange(filters: {
		role: string | undefined;
		status: UserStatusFilter | undefined;
	}) {
		tableParams.role = filters.role === 'admin' || filters.role === 'user' ? filters.role : 'all';
		tableParams.status = filters.status ?? 'all';
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
			const nextSorting = typeof updater === 'function' ? updater(sorting) : updater;
			tableParams.sort = serializeSortParam(nextSorting);
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

<div class="flex flex-col gap-6 px-4 lg:px-6 xl:px-8 2xl:px-16" data-testid="admin-users-page">
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
					data-testid="admin-users-search"
					value={tableParams.search}
					oninput={handleSearchInput}
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
	<div class="overflow-hidden rounded-md border" data-testid="admin-users-table">
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
					<Table.Row data-testid="admin-users-loading" class="hidden">
						<Table.Cell colspan={columns.length}>
							<T keyName="admin.users.loading" />
						</Table.Cell>
					</Table.Row>
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
							data-testid="admin-users-empty"
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
			<div
				class="flex w-fit items-center justify-center text-sm font-medium"
				data-testid="admin-users-page-indicator"
			>
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
					data-testid="admin-users-pagination-prev"
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
					data-testid="admin-users-pagination-next"
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
						<Field.Group>
							<Field.Field>
								<Input
									placeholder={$t('admin.dialog.ban_reason_placeholder')}
									bind:value={banReason}
								/>
							</Field.Field>
						</Field.Group>
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
