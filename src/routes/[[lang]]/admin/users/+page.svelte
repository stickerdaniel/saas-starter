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
	import * as Field from '$lib/components/ui/field/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Skeleton } from '$lib/components/ui/skeleton/index.js';
	import { Checkbox } from '$lib/components/ui/checkbox/index.js';
	import DotsVerticalIcon from '@tabler/icons-svelte/icons/dots-vertical';
	import { T, getTranslate } from '@tolgee/svelte';

	const { t } = getTranslate();
	import { useConvexClient } from 'convex-svelte';
	import { api } from '$lib/convex/_generated/api.js';
	import { authClient } from '$lib/auth-client.js';
	import { toast } from 'svelte-sonner';
	import { setContext } from 'svelte';
	import { adminCache } from '$lib/hooks/admin-cache.svelte';
	import type { PageData } from './$types';
	import { type UserRole, type AdminUserData } from '$lib/convex/admin/types';
	import { createSvelteTable, FlexRender } from '$lib/components/ui/data-table/index.js';
	import ConvexCursorTableShell from '$lib/components/tables/convex-cursor-table-shell.svelte';
	import { createConvexCursorTable } from '$lib/tables/convex/create-convex-cursor-table.svelte';
	import type { CursorListResult } from '$lib/tables/convex/contract';
	import { columns } from './columns.js';
	import DataTableFilters from './data-table-filters.svelte';
	import type { ActionEvent } from './data-table-actions.svelte';

	let { data: _data }: { data: PageData } = $props();

	const client = useConvexClient();

	type UserStatusFilter = 'verified' | 'unverified' | 'banned';
	type SortQueryField = 'created_at' | 'email' | 'name' | 'role';

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
	const SORT_QUERY_FIELD_TO_BACKEND_FIELD = {
		created_at: 'createdAt',
		email: 'email',
		name: 'name',
		role: 'role'
	} as const;

	const PAGE_SIZE_OPTIONS = ['1', '10', '20', '30', '40', '50'] as const;
	const PAGE_SIZE_NUM_OPTIONS = [1, 10, 20, 30, 40, 50] as const;

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

	const usersTable = createConvexCursorTable<
		AdminUserData,
		'role' | 'status',
		SortQueryField,
		typeof api.admin.queries.listUsers,
		typeof api.admin.queries.getUserCount,
		v.InferOutput<typeof usersTableParamsSchema>
	>({
		listQuery: api.admin.queries.listUsers,
		countQuery: api.admin.queries.getUserCount,
		urlSchema: usersTableParamsSchema,
		defaultFilters: {
			role: 'all',
			status: 'all'
		},
		pageSizeOptions: PAGE_SIZE_OPTIONS,
		defaultPageSize: '10',
		sortFields: ['created_at', 'email', 'name', 'role'],
		buildListArgs: ({ cursor, pageSize, search, filters, sortBy }) => ({
			cursor: cursor ?? undefined,
			numItems: pageSize,
			search,
			roleFilter: filters.role === 'all' ? undefined : (filters.role as 'admin' | 'user'),
			statusFilter:
				filters.status === 'all'
					? undefined
					: (filters.status as 'verified' | 'unverified' | 'banned'),
			sortBy: sortBy
				? {
						field: SORT_QUERY_FIELD_TO_BACKEND_FIELD[sortBy.field],
						direction: sortBy.direction
					}
				: undefined
		}),
		buildCountArgs: ({ search, filters }) => ({
			search,
			roleFilter: filters.role === 'all' ? undefined : (filters.role as 'admin' | 'user'),
			statusFilter:
				filters.status === 'all'
					? undefined
					: (filters.status as 'verified' | 'unverified' | 'banned')
		}),
		resolveLastPage: async ({ pageSize, search, filters, sortBy }) => {
			const result = await client.query(api.admin.queries.resolveUsersLastPage, {
				numItems: pageSize,
				search,
				roleFilter: filters.role === 'all' ? undefined : (filters.role as 'admin' | 'user'),
				statusFilter:
					filters.status === 'all'
						? undefined
						: (filters.status as 'verified' | 'unverified' | 'banned'),
				sortBy: sortBy
					? {
							field: SORT_QUERY_FIELD_TO_BACKEND_FIELD[sortBy.field],
							direction: sortBy.direction
						}
					: undefined
			});
			return {
				page: result.page,
				cursor: result.cursor
			};
		},
		toListResult: (result) =>
			({
				items: result.users,
				continueCursor: result.continueCursor,
				isDone: result.isDone
			}) as CursorListResult<AdminUserData>,
		toCount: (result) => result
	});

	const tableParams = $derived(usersTable.currentUrlState);
	const pageIndex = $derived(usersTable.pageIndex);
	const pageSize = $derived(usersTable.pageSize);
	const sorting = $derived.by<SortingState>(() => {
		const sortBy = usersTable.sortBy;
		if (!sortBy) return [];
		const columnId = SORT_QUERY_FIELD_TO_COLUMN[sortBy.field];
		if (!columnId) return [];
		return [{ id: columnId, desc: sortBy.direction === 'desc' }];
	});
	const roleFilter = $derived.by(() =>
		usersTable.filters.role === 'all' ? undefined : usersTable.filters.role
	);
	const statusFilter = $derived.by(() =>
		usersTable.filters.status === 'all'
			? undefined
			: (usersTable.filters.status as UserStatusFilter)
	);
	const isLoading = $derived(usersTable.isLoading);

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

	// Update user count cache when count data loads
	$effect(() => {
		if (usersTable.hasLoadedCount) {
			adminCache.userCount.current = usersTable.totalCount;
		}
	});

	// Filter change handler (called from DataTableFilters)
	function handleFilterChange(filters: {
		role: string | undefined;
		status: UserStatusFilter | undefined;
	}) {
		usersTable.setFilter(
			'role',
			filters.role === 'admin' || filters.role === 'user' ? filters.role : 'all'
		);
		usersTable.setFilter('status', filters.status ?? 'all');
	}

	// Create the table (manual pagination mode)
	const table = createSvelteTable({
		get data() {
			return usersTable.rows;
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
			return usersTable.pageCount;
		},
		getRowId: (row) => row.id,
		getCoreRowModel: getCoreRowModel(),
		onSortingChange: (updater) => {
			const nextSorting = typeof updater === 'function' ? updater(sorting) : updater;
			if (nextSorting.length === 0) {
				usersTable.setSort(undefined);
				return;
			}
			const primarySort = nextSorting[0];
			const field =
				SORT_COLUMN_TO_QUERY_FIELD[primarySort.id as keyof typeof SORT_COLUMN_TO_QUERY_FIELD];
			if (!field) {
				usersTable.setSort(undefined);
				return;
			}
			usersTable.setSort({
				field,
				direction: primarySort.desc ? 'desc' : 'asc'
			});
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

	<ConvexCursorTableShell
		testIdPrefix="admin-users"
		tableTestId="admin-users-table"
		searchValue={tableParams.search}
		searchPlaceholder={$t('admin.users.search_placeholder')}
		onSearchChange={usersTable.setSearch}
		pageIndex={usersTable.pageIndex}
		pageCount={usersTable.pageCount}
		pageSize={usersTable.pageSize}
		pageSizeOptions={PAGE_SIZE_NUM_OPTIONS}
		canPreviousPage={usersTable.canPreviousPage}
		canNextPage={usersTable.canNextPage}
		onFirstPage={usersTable.goFirst}
		onPreviousPage={usersTable.goPrevious}
		onNextPage={usersTable.goNext}
		onLastPage={usersTable.goLast}
		onPageSizeChange={usersTable.setPageSize}
		rowsPerPageLabel={$t('admin.users.rows_per_page')}
		selectionText={$t('admin.users.selected', {
			selected: Object.keys(rowSelection).length,
			total: usersTable.hasLoadedCount ? usersTable.totalCount : (adminCache.userCount.current ?? 0)
		})}
	>
		{#snippet toolbarFilters()}
			<DataTableFilters {roleFilter} {statusFilter} onFilterChange={handleFilterChange} />
		{/snippet}

		{#snippet tableContent()}
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
					{#if isLoading && skeletonCount > 0}
						<Table.Row data-testid="admin-users-loading" class="hidden">
							<Table.Cell colspan={columns.length}>
								<T keyName="admin.users.loading" />
							</Table.Cell>
						</Table.Row>
						{#each Array(skeletonCount) as _, i (i)}
							<Table.Row>
								<Table.Cell class="[&:has([role=checkbox])]:ps-3">
									<div class="flex items-center justify-center">
										<Checkbox disabled aria-label={$t('admin.users.select_row')} />
									</div>
								</Table.Cell>
								<Table.Cell>
									<div class="flex items-center gap-2">
										<Skeleton class="size-8 rounded-full" />
										<span class="font-medium">
											<Skeleton class="h-4 w-20" />
										</span>
									</div>
								</Table.Cell>
								<Table.Cell>
									<Skeleton class="h-4 w-48" />
								</Table.Cell>
								<Table.Cell>
									<Skeleton class="h-5 w-12 rounded-md" />
								</Table.Cell>
								<Table.Cell>
									<Skeleton class="h-5 w-[65px] rounded-md" />
								</Table.Cell>
								<Table.Cell>
									<Skeleton class="h-4 w-20" />
								</Table.Cell>
								<Table.Cell>
									<Button variant="ghost" size="icon" disabled>
										<DotsVerticalIcon class="size-4" />
										<span class="sr-only"><T keyName="admin.users.menu_open" /></span>
									</Button>
								</Table.Cell>
							</Table.Row>
						{/each}
					{:else if table.getRowModel().rows.length === 0 || (isLoading && skeletonCount === 0)}
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
		{/snippet}
	</ConvexCursorTableShell>
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
