<script lang="ts">
	import SEOHead from '$lib/components/SEOHead.svelte';
	import type * as v from 'valibot';
	import { ConfirmDialog, confirm } from '$lib/components/ui/confirm-dialog/index.js';
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
	import { createCursorSorting } from '$lib/tables/convex/sorting.svelte.ts';
	import { createTableUrlSchema } from '$lib/tables/convex/url';
	import { toCursorListResult, type TableSortBy } from '$lib/tables/convex/contract';
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
	type ProviderFilter = 'credential' | 'google' | 'github' | 'passkey';

	const SORT_COLUMN_TO_QUERY_FIELD = {
		createdAt: 'created_at',
		email: 'email',
		name: 'name',
		role: 'role',
		providers: 'provider'
	} as const;
	const SORT_QUERY_FIELD_TO_BACKEND_FIELD = {
		created_at: 'createdAt',
		email: 'email',
		name: 'name',
		role: 'role',
		provider: 'provider'
	} as const;

	const PAGE_SIZES = [1, 10, 20, 30, 40, 50];
	const DEFAULT_PAGE_SIZE = 10;

	const usersTableParamsSchema = createTableUrlSchema({
		filters: {
			role: ['all', 'admin', 'user'],
			status: ['all', 'verified', 'unverified', 'banned'],
			provider: ['all', 'credential', 'google', 'github', 'passkey']
		},
		pageSizes: PAGE_SIZES,
		defaultPageSize: DEFAULT_PAGE_SIZE
	});

	function filterArgs(filters: Record<'role' | 'status' | 'provider', string>) {
		return {
			roleFilter: filters.role === 'all' ? undefined : (filters.role as 'admin' | 'user'),
			statusFilter: filters.status === 'all' ? undefined : (filters.status as UserStatusFilter),
			providerFilter: filters.provider === 'all' ? undefined : (filters.provider as ProviderFilter)
		};
	}

	function backendSortBy(sortBy: TableSortBy<SortQueryField> | undefined) {
		return sortBy
			? { field: SORT_QUERY_FIELD_TO_BACKEND_FIELD[sortBy.field], direction: sortBy.direction }
			: undefined;
	}

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
		pageSizes: PAGE_SIZES,
		defaultPageSize: DEFAULT_PAGE_SIZE,
		sortFields: ['created_at', 'email', 'name', 'role', 'provider'],
		buildListArgs: ({ cursor, pageSize, search, filters, sortBy }) => ({
			cursor: cursor ?? undefined,
			numItems: pageSize,
			search,
			...filterArgs(filters),
			sortBy: backendSortBy(sortBy)
		}),
		buildCountArgs: ({ search, filters }) => ({ search, ...filterArgs(filters) }),
		resolveLastPage: async ({ pageSize, search, filters, sortBy }) => {
			const result = await client.query(api.admin.queries.resolveUsersLastPage, {
				numItems: pageSize,
				search,
				...filterArgs(filters),
				sortBy: backendSortBy(sortBy)
			});
			return {
				page: result.page,
				cursor: result.cursor
			};
		},
		toListResult: toCursorListResult,
		toCount: (result) => result
	});

	const tableParams = $derived(usersTable.currentUrlState);
	const pageIndex = $derived(usersTable.pageIndex);
	const pageSize = $derived(usersTable.pageSize);
	const cursorSorting = createCursorSorting({
		table: usersTable,
		columnToField: SORT_COLUMN_TO_QUERY_FIELD
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
				return cursorSorting.sorting;
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
		onSortingChange: cursorSorting.onSortingChange,
		onRowSelectionChange: rowSelection.onChange
	});

	// Action handlers
	function handleUserAction(event: ActionEvent) {
		switch (event.type) {
			case 'impersonate':
				void startImpersonation(event.userId);
				break;
			case 'openRoleDialog':
				confirmRole(event.user, event.role);
				break;
			case 'openBanDialog':
				confirmBan(event.user);
				break;
			case 'openUnbanDialog':
				confirmUnban(event.user);
				break;
			case 'openRevokeDialog':
				confirmRevoke(event.user);
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

	// Each confirmation captures its own user, role and reason. A failed mutation
	// rethrows after its toast so the confirmation stays open for a retry.
	function confirmBan(user: AdminUserData) {
		confirm({
			title: $t('admin.dialog.ban_title'),
			description: $t('admin.dialog.ban_description', { email: user.email }),
			confirmText: $t('common.confirm'),
			tone: 'destructive',
			field: {
				label: $t('admin.dialog.ban_reason_label'),
				placeholder: $t('admin.dialog.ban_reason_placeholder')
			},
			onConfirm: async (reason) => {
				const defaultBanReason = $t('admin.users.ban_reason.default');
				try {
					await client.mutation(api.admin.mutations.banUser, {
						userId: user.id,
						reason: reason || defaultBanReason
					});
					toast.success($t('admin.users.toast.banned'));
				} catch (error) {
					const message = adminAuthErrorMessage(error);
					toast.error($t('admin.users.toast.ban_failed', { message }));
					console.error('Ban error:', error);
					throw error;
				}
			}
		});
	}

	function confirmUnban(user: AdminUserData) {
		confirm({
			title: $t('admin.dialog.unban_title'),
			description: $t('admin.dialog.unban_description', { email: user.email }),
			confirmText: $t('common.confirm'),
			tone: 'default',
			onConfirm: async () => {
				try {
					await client.mutation(api.admin.mutations.unbanUser, { userId: user.id });
					toast.success($t('admin.users.toast.unbanned'));
				} catch (error) {
					const message = adminAuthErrorMessage(error);
					toast.error($t('admin.users.toast.unban_failed', { message }));
					console.error('Unban error:', error);
					throw error;
				}
			}
		});
	}

	function confirmRevoke(user: AdminUserData) {
		confirm({
			title: $t('admin.dialog.revoke_title'),
			description: $t('admin.dialog.revoke_description', { email: user.email }),
			confirmText: $t('common.confirm'),
			tone: 'default',
			onConfirm: async () => {
				try {
					await client.mutation(api.admin.mutations.revokeUserSessions, { userId: user.id });
					toast.success($t('admin.users.toast.revoked'));
				} catch (error) {
					const message = adminAuthErrorMessage(error);
					toast.error($t('admin.users.toast.revoke_failed', { message }));
					console.error('Revoke sessions error:', error);
					throw error;
				}
			}
		});
	}

	function confirmRole(user: AdminUserData, role: UserRole) {
		confirm({
			title: $t('admin.dialog.set_role_title'),
			description: $t('admin.dialog.set_role_description', { email: user.email, role }),
			confirmText: $t('common.confirm'),
			tone: 'default',
			onConfirm: async () => {
				try {
					await client.mutation(api.admin.mutations.setUserRole, { userId: user.id, role });
					toast.success($t('admin.users.toast.role_updated', { role }));
				} catch (error) {
					const message = actionErrorMessage(error);
					toast.error($t('admin.users.toast.role_failed', { message }));
					console.error('Set role error:', error);
					throw error;
				}
			}
		});
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
			pageSizeOptions={usersTable.pageSizes}
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

<ConfirmDialog />
