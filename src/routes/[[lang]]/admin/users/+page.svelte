<script lang="ts">
	import SEOHead from '$lib/components/SEOHead.svelte';
	import * as v from 'valibot';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import * as Field from '$lib/components/ui/field/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { T, getTranslate } from '@tolgee/svelte';

	const { t } = getTranslate();
	import { useConvexClient } from 'convex-svelte';
	import { api } from '$lib/convex/_generated/api.js';
	import { authClient } from '$lib/auth-client.js';
	import { toast } from 'svelte-sonner';
	import { setContext } from 'svelte';
	import type { PageData } from './$types';
	import { type UserRole, type AdminUserData } from '$lib/convex/admin/types';
	import ConvexTanStackTable from '$lib/tables/convex/convex-tanstack-table.svelte';
	import { createConvexTanStackTable } from '$lib/tables/convex/create-convex-tanstack-table.svelte';
	import type { BaseTableRenderConfig } from '$lib/tables/core/types';
	import { getTableSkeletonColumnsFromColumnDefs } from '$lib/components/tables/table-loading-skeleton.js';
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

	const usersTable = createConvexTanStackTable<
		AdminUserData,
		'role' | 'status',
		SortQueryField,
		typeof api.admin.queries.listUsers,
		typeof api.admin.queries.getUserCount,
		v.InferOutput<typeof usersTableParamsSchema>
	>({
		convex: {
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
		},
		columns,
		getRowId: (row) => row.id,
		sortMaps: {
			columnToSort: SORT_COLUMN_TO_QUERY_FIELD,
			sortToColumn: SORT_QUERY_FIELD_TO_COLUMN
		}
	});

	const tableParams = $derived(usersTable.convex.currentUrlState);
	const roleFilter = $derived.by(() =>
		usersTable.convex.filters.role === 'all' ? undefined : usersTable.convex.filters.role
	);
	const statusFilter = $derived.by(() =>
		usersTable.convex.filters.status === 'all'
			? undefined
			: (usersTable.convex.filters.status as UserStatusFilter)
	);

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

	const usersSkeletonColumns = getTableSkeletonColumnsFromColumnDefs(columns);

	// Filter change handler (called from DataTableFilters)
	function handleFilterChange(filters: {
		role: string | undefined;
		status: UserStatusFilter | undefined;
	}) {
		usersTable.convex.setFilter(
			'role',
			filters.role === 'admin' || filters.role === 'user' ? filters.role : 'all'
		);
		usersTable.convex.setFilter('status', filters.status ?? 'all');
	}
	const usersTableRenderConfig = $derived.by<BaseTableRenderConfig>(() => ({
		testIdPrefix: 'admin-users',
		searchValue: tableParams.search,
		searchPlaceholder: $t('admin.users.search_placeholder'),
		onSearchChange: usersTable.convex.setSearch,
		pageIndex: usersTable.convex.pageIndex,
		pageCount: usersTable.convex.displayPageCount,
		pageSize: usersTable.convex.pageSize,
		pageSizeOptions: PAGE_SIZE_NUM_OPTIONS,
		canPreviousPage: usersTable.convex.canPreviousPage,
		canNextPage: usersTable.convex.canNextPage,
		onFirstPage: usersTable.convex.goFirst,
		onPreviousPage: usersTable.convex.goPrevious,
		onNextPage: usersTable.convex.goNext,
		onLastPage: usersTable.convex.goLast,
		onPageSizeChange: usersTable.convex.setPageSize,
		rowsPerPageLabel: $t('admin.users.rows_per_page'),
		selectionText: $t('admin.users.selected', {
			selected: usersTable.selectedCount,
			total: usersTable.convex.displayTotalCount
		}),
		emptyKey: 'admin.users.no_results',
		emptyTestId: 'admin-users-empty',
		loadingLabelKey: 'admin.users.loading',
		skeletonColumns: usersSkeletonColumns,
		skeletonRowCount: usersTable.convex.skeletonRowCount,
		colspan: columns.length,
		testIds: {
			table: 'admin-users-table',
			loading: 'admin-users-loading'
		}
	}));

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

	<ConvexTanStackTable
		table={usersTable.table}
		config={usersTableRenderConfig}
		rowTestId={(row) => `admin-users-row-${row.id}`}
	>
		{#snippet toolbarFilters()}
			<DataTableFilters {roleFilter} {statusFilter} onFilterChange={handleFilterChange} />
		{/snippet}
	</ConvexTanStackTable>
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
