<script lang="ts">
	import SEOHead from '$lib/components/SEOHead.svelte';
	import * as v from 'valibot';
	import { type SortingState } from '@tanstack/table-core';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import * as Field from '$lib/components/ui/field/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { T, getTranslate } from '@tolgee/svelte';

	const { t } = getTranslate();
	import { useConvexClient, useQuery } from 'convex-svelte';
	import { api } from '$lib/convex/_generated/api.js';
	import { activeUploadsContext } from '$lib/hooks/active-uploads.svelte.ts';
	import { impersonateUser } from '../impersonate-user';
	import { toast } from 'svelte-sonner';
	import { setUserActionHandler } from './user-actions-context';
	import { adminCache } from '$lib/hooks/admin-cache.svelte.ts';
	import type { PageData } from './$types';
	import { type UserRole, type AdminUserData } from '$lib/convex/admin/types';
	import { createSvelteTable } from '$lib/components/ui/data-table/index.js';
	import { createRowSelection } from '$lib/components/ui/data-table/row-selection.svelte.ts';
	import ConvexCursorTableShell from '$lib/components/tables/convex-cursor-table-shell.svelte';
	import DataTableView from '$lib/components/tables/data-table-view.svelte';
	import { createConvexCursorTable } from '$lib/tables/convex/create-convex-cursor-table.svelte.ts';
	import { createCountPrediction } from '$lib/tables/convex/count-prediction.svelte.ts';
	import type { CursorListResult } from '$lib/tables/convex/contract';
	import { createColumns } from './columns.js';
	import DataTableFilters from './data-table-filters.svelte';
	import type { ActionEvent } from './data-table-actions.svelte';
	import { browser } from '$app/environment';
	import { getAuthErrorKey } from '$lib/utils/auth-messages';
	import { getConvexErrorCode, getConvexErrorData } from '$lib/utils/convex-errors';

	// Consulted right before an impersonation start leaves the document.
	const activeUploads = activeUploadsContext.getOr(null);

	let { data }: { data: PageData } = $props();

	const columns = $derived(createColumns(data.lang ?? 'en'));

	const client = useConvexClient();
	const oauthProviders = useQuery(api.auth.getAvailableOAuthProviders, {}, () => ({
		initialData: data.oauthProviders
	}));

	type UserStatusFilter = 'verified' | 'unverified' | 'banned';
	type SortQueryField = 'created_at' | 'email' | 'name' | 'role' | 'provider';

	const SORT_COLUMN_TO_QUERY_FIELD = {
		createdAt: 'created_at',
		email: 'email',
		name: 'name',
		role: 'role',
		providers: 'provider'
	} as const;

	const SORT_QUERY_FIELD_TO_COLUMN = {
		created_at: 'createdAt',
		email: 'email',
		name: 'name',
		role: 'role',
		provider: 'providers'
	} as const;
	const SORT_QUERY_FIELD_TO_BACKEND_FIELD = {
		created_at: 'createdAt',
		email: 'email',
		name: 'name',
		role: 'role',
		provider: 'provider'
	} as const;

	const PAGE_SIZE_OPTIONS = ['1', '10', '20', '30', '40', '50'] as const;
	const PAGE_SIZE_NUM_OPTIONS = [1, 10, 20, 30, 40, 50] as const;

	type ProviderFilter = 'credential' | 'google' | 'github' | 'passkey';

	const usersTableParamsSchema = v.object({
		search: v.optional(v.fallback(v.string(), ''), ''),
		role: v.optional(v.fallback(v.picklist(['all', 'admin', 'user']), 'all'), 'all'),
		status: v.optional(
			v.fallback(v.picklist(['all', 'verified', 'unverified', 'banned']), 'all'),
			'all'
		),
		provider: v.optional(
			v.fallback(v.picklist(['all', 'credential', 'google', 'github', 'passkey']), 'all'),
			'all'
		),
		sort: v.optional(v.fallback(v.string(), ''), ''),
		page: v.optional(v.fallback(v.string(), '1'), '1'),
		page_size: v.optional(v.fallback(v.picklist(PAGE_SIZE_OPTIONS), '10'), '10'),
		cursor: v.optional(v.fallback(v.string(), ''), '')
	});

	const usersTable = createConvexCursorTable<
		AdminUserData,
		'role' | 'status' | 'provider',
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
			status: 'all',
			provider: 'all'
		},
		pageSizeOptions: PAGE_SIZE_OPTIONS,
		defaultPageSize: '10',
		sortFields: ['created_at', 'email', 'name', 'role', 'provider'],
		buildListArgs: ({ cursor, pageSize, search, filters, sortBy }) => ({
			cursor: cursor ?? undefined,
			numItems: pageSize,
			search,
			roleFilter: filters.role === 'all' ? undefined : (filters.role as 'admin' | 'user'),
			statusFilter:
				filters.status === 'all'
					? undefined
					: (filters.status as 'verified' | 'unverified' | 'banned'),
			providerFilter: filters.provider === 'all' ? undefined : (filters.provider as ProviderFilter),
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
					: (filters.status as 'verified' | 'unverified' | 'banned'),
			providerFilter: filters.provider === 'all' ? undefined : (filters.provider as ProviderFilter)
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
				providerFilter:
					filters.provider === 'all' ? undefined : (filters.provider as ProviderFilter),
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
				items: result.items,
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
	const providerFilter = $derived.by(() =>
		usersTable.filters.provider === 'all'
			? undefined
			: (usersTable.filters.provider as ProviderFilter)
	);
	const isLoading = $derived(usersTable.isLoading);
	const loadError = $derived(usersTable.error);

	const countPrediction = createCountPrediction({ table: usersTable, cache: adminCache.userCount });

	// TanStack Table state (only client-side concerns remain)
	const rowSelection = createRowSelection(() => usersTable.rows.map((row) => row.id));

	// Dialog state
	let selectedUser = $state<AdminUserData | null>(null);
	let actionType = $state<'ban' | 'unban' | 'revoke' | null>(null);
	let banReason = $state('');
	let dialogOpen = $state(false);
	let roleDialogOpen = $state(false);
	let selectedRole = $state<UserRole>('user');
	let isActionLoading = $state(false);

	// Provide context for action component (currentUserId is set by admin layout)
	setUserActionHandler(handleUserAction);

	// Filter change handler (called from DataTableFilters)
	function handleFilterChange(filters: {
		role: string | undefined;
		status: UserStatusFilter | undefined;
		provider: ProviderFilter | undefined;
	}) {
		usersTable.setFilter(
			'role',
			filters.role === 'admin' || filters.role === 'user' ? filters.role : 'all'
		);
		usersTable.setFilter('status', filters.status ?? 'all');
		usersTable.setFilter('provider', filters.provider ?? 'all');
	}

	// Create the table (manual pagination mode)
	const table = createSvelteTable({
		get data() {
			return usersTable.rows;
		},
		get columns() {
			return columns;
		},
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
			return usersTable.pageCount;
		},
		getRowId: (row) => row.id,
		onSortingChange: (updater) => {
			const nextSorting = typeof updater === 'function' ? updater(sorting) : updater;
			if (nextSorting.length === 0) {
				usersTable.setSort(undefined);
				return;
			}
			const primarySort = nextSorting[0]!;
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
		onRowSelectionChange: rowSelection.onChange
	});

	// Action handlers
	function handleUserAction(event: ActionEvent) {
		switch (event.type) {
			case 'impersonate':
				void startImpersonation(event.userId);
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

	function actionErrorMessage(error: unknown): string {
		const key = (() => {
			switch (getConvexErrorCode(error)) {
				case 'ADMIN_ACCESS_REQUIRED':
					return 'admin.users.errors.access_required';
				case 'ADMIN_CANNOT_CHANGE_OWN_ROLE':
					return 'admin.users.errors.cannot_change_own_role';
				case 'ADMIN_USER_NOT_FOUND':
					return 'admin.users.errors.user_not_found';
				case 'ADMIN_LAST_ADMIN':
					return 'admin.users.errors.last_admin';
				default:
					return 'admin.users.errors.unknown';
			}
		})();
		return $t(key);
	}

	function adminAuthErrorMessage(error: unknown): string {
		return $t(getAuthErrorKey(getConvexErrorData(error)));
	}

	async function startImpersonation(userId: string) {
		const outcome = await impersonateUser(userId, activeUploads);
		if (!outcome.started) {
			toast.error($t('admin.users.toast.impersonate_failed', { message: $t(outcome.messageKey) }));
		}
	}

	async function banUser() {
		if (!selectedUser) return;

		isActionLoading = true;
		const defaultBanReason = $t('admin.users.ban_reason.default');
		try {
			await client.mutation(api.admin.mutations.banUser, {
				userId: selectedUser.id,
				reason: banReason || defaultBanReason
			});

			toast.success($t('admin.users.toast.banned'));
			closeDialog();
		} catch (error) {
			const message = adminAuthErrorMessage(error);
			toast.error($t('admin.users.toast.ban_failed', { message }));
			console.error('Ban error:', error);
		} finally {
			isActionLoading = false;
		}
	}

	async function unbanUser() {
		if (!selectedUser) return;

		isActionLoading = true;
		try {
			await client.mutation(api.admin.mutations.unbanUser, {
				userId: selectedUser.id
			});

			toast.success($t('admin.users.toast.unbanned'));
			closeDialog();
		} catch (error) {
			const message = adminAuthErrorMessage(error);
			toast.error($t('admin.users.toast.unban_failed', { message }));
			console.error('Unban error:', error);
		} finally {
			isActionLoading = false;
		}
	}

	async function revokeSessions() {
		if (!selectedUser) return;

		isActionLoading = true;
		try {
			await client.mutation(api.admin.mutations.revokeUserSessions, {
				userId: selectedUser.id
			});

			toast.success($t('admin.users.toast.revoked'));
			closeDialog();
		} catch (error) {
			const message = adminAuthErrorMessage(error);
			toast.error($t('admin.users.toast.revoke_failed', { message }));
			console.error('Revoke sessions error:', error);
		} finally {
			isActionLoading = false;
		}
	}

	async function setUserRole() {
		if (!selectedUser) return;

		isActionLoading = true;
		try {
			await client.mutation(api.admin.mutations.setUserRole, {
				userId: selectedUser.id,
				role: selectedRole
			});

			toast.success($t('admin.users.toast.role_updated', { role: selectedRole }));
			closeRoleDialog();
		} catch (error) {
			const message = actionErrorMessage(error);
			toast.error($t('admin.users.toast.role_failed', { message }));
			console.error('Set role error:', error);
		} finally {
			isActionLoading = false;
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

<SEOHead
	title={$t('meta.admin.users.title')}
	description={$t('meta.admin.users.description')}
	noindex
/>

<div class="flex flex-col gap-6 px-4 lg:px-6 xl:px-8 2xl:px-16" data-testid="admin-users-page">
	<!-- Header -->
	<div class="flex items-center justify-between">
		<h1 class="text-2xl font-bold"><T keyName="admin.users.title" /></h1>
	</div>

	{#if browser}<ConvexCursorTableShell
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
			selectionText={$t('admin.users.selected', {
				selected: rowSelection.count,
				total: countPrediction.total
			})}
		>
			{#snippet toolbarFilters()}
				<DataTableFilters
					{roleFilter}
					{statusFilter}
					{providerFilter}
					availableOAuthProviders={oauthProviders.data}
					onFilterChange={handleFilterChange}
				/>
			{/snippet}

			{#snippet tableContent()}
				<DataTableView
					{table}
					loading={isLoading}
					error={loadError}
					skeletonRows={countPrediction.skeletonRows}
					emptyText={$t('admin.users.no_results')}
					loadingText={$t('admin.users.loading')}
					testIdPrefix="admin-users"
				/>
			{/snippet}
		</ConvexCursorTableShell>{/if}
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
								<Field.Label class="sr-only" for="admin-users-ban-reason">
									<T keyName="admin.dialog.ban_reason_label" />
								</Field.Label>
								<Input
									id="admin-users-ban-reason"
									placeholder={$t('admin.dialog.ban_reason_placeholder')}
									data-testid="admin-users-ban-reason-input"
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
			<Button
				variant="outline"
				onclick={closeDialog}
				disabled={isActionLoading}
				data-testid="admin-users-dialog-cancel"><T keyName="common.cancel" /></Button
			>
			<Button
				onclick={() => {
					if (actionType === 'ban') banUser();
					else if (actionType === 'unban') unbanUser();
					else if (actionType === 'revoke') revokeSessions();
				}}
				variant={actionType === 'ban' ? 'destructive' : 'default'}
				disabled={isActionLoading}
				data-testid="admin-users-dialog-confirm"
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
			<Button variant="outline" onclick={closeRoleDialog} disabled={isActionLoading}
				><T keyName="common.cancel" /></Button
			>
			<Button
				onclick={setUserRole}
				disabled={isActionLoading}
				data-testid="admin-users-role-dialog-confirm"
			>
				<T keyName="common.confirm" />
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
