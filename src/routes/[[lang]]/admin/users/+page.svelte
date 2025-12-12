<script lang="ts">
	import * as Table from '$lib/components/ui/table/index.js';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import DotsVerticalIcon from '@tabler/icons-svelte/icons/dots-vertical';
	import UserIcon from '@tabler/icons-svelte/icons/user';
	import UserOffIcon from '@tabler/icons-svelte/icons/user-off';
	import UserCheckIcon from '@tabler/icons-svelte/icons/user-check';
	import LogoutIcon from '@tabler/icons-svelte/icons/logout';
	import SearchIcon from '@tabler/icons-svelte/icons/search';
	import ShieldIcon from '@tabler/icons-svelte/icons/shield';
	import CheckIcon from '@tabler/icons-svelte/icons/check';
	import { T } from '@tolgee/svelte';
	import { useQuery, useConvexClient } from 'convex-svelte';
	import { api } from '$lib/convex/_generated/api.js';
	import { authClient } from '$lib/auth-client.js';
	import { goto } from '$app/navigation';
	import { localizedHref } from '$lib/utils/i18n';
	import { toast } from 'svelte-sonner';
	import type { PageData } from './$types';
	import { USER_ROLES, type UserRole, type AdminUserData } from '$lib/convex/admin/types';

	let { data }: { data: PageData } = $props();

	const client = useConvexClient();

	let searchQuery = $state('');
	let selectedUser = $state<AdminUserData | null>(null);
	let actionType = $state<'ban' | 'unban' | 'revoke' | null>(null);
	let banReason = $state('');
	let dialogOpen = $state(false);

	// Role management state
	let roleDialogOpen = $state(false);
	let selectedRole = $state<UserRole>('user');

	// Fetch users with search - use a getter function to make search reactive
	const users = useQuery(api.admin.queries.listUsers, () => ({ search: searchQuery || undefined }));

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

	// Impersonate user
	async function impersonateUser(userId: string) {
		try {
			const result = await authClient.admin.impersonateUser({ userId });
			if (result.error) {
				const message = result.error.message || 'Unknown error';
				toast.error(`Failed to impersonate user: ${message}`);
				console.error('Impersonation error:', result.error);
				return;
			}

			// Log the action
			await logAdminAction('impersonate', userId, {});

			toast.success('Now impersonating user');
			goto(localizedHref('/app'));
		} catch (error) {
			const message = error instanceof Error ? error.message : 'Unknown error';
			toast.error(`Failed to impersonate user: ${message}`);
			console.error('Impersonation error:', error);
		}
	}

	// Ban user
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

			// Log the action
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

	// Unban user
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

			// Log the action
			await logAdminAction('unban_user', selectedUser.id, {});

			toast.success('User has been unbanned');
			closeDialog();
		} catch (error) {
			const message = error instanceof Error ? error.message : 'Unknown error';
			toast.error(`Failed to unban user: ${message}`);
			console.error('Unban error:', error);
		}
	}

	// Revoke sessions
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

			// Log the action
			await logAdminAction('revoke_sessions', selectedUser.id, {});

			toast.success('All sessions have been revoked');
			closeDialog();
		} catch (error) {
			const message = error instanceof Error ? error.message : 'Unknown error';
			toast.error(`Failed to revoke sessions: ${message}`);
			console.error('Revoke sessions error:', error);
		}
	}

	// Set user role
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

	function formatDate(timestamp: number | undefined) {
		if (!timestamp) return '-';
		return new Date(timestamp).toLocaleDateString();
	}

	// Check if the user is the current admin (to prevent self-modification in UI)
	function isCurrentUser(userId: string): boolean {
		return data.viewer?._id === userId;
	}
</script>

<div class="flex flex-col gap-6 px-4 lg:px-6">
	<div class="flex items-center justify-between">
		<h1 class="text-2xl font-bold"><T keyName="admin.users.title" /></h1>
		<div class="text-sm text-muted-foreground">
			{users.data?.totalCount ?? 0}
			<T keyName="admin.users.total" />
		</div>
	</div>

	<!-- Search -->
	<div class="relative max-w-sm">
		<SearchIcon class="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
		<Input type="search" placeholder="Search users..." class="pl-10" bind:value={searchQuery} />
	</div>

	<!-- Users Table -->
	<div class="rounded-md border">
		<Table.Root>
			<Table.Header>
				<Table.Row>
					<Table.Head><T keyName="admin.users.name" /></Table.Head>
					<Table.Head><T keyName="admin.users.email" /></Table.Head>
					<Table.Head><T keyName="admin.users.role" /></Table.Head>
					<Table.Head><T keyName="admin.users.status" /></Table.Head>
					<Table.Head><T keyName="admin.users.created" /></Table.Head>
					<Table.Head class="w-[70px]"></Table.Head>
				</Table.Row>
			</Table.Header>
			<Table.Body>
				{#if users.data?.users}
					{#each users.data.users as user}
						<Table.Row>
							<Table.Cell class="font-medium">
								<div class="flex items-center gap-2">
									{#if user.image}
										<img src={user.image} alt={user.name} class="size-8 rounded-full" />
									{:else}
										<div class="flex size-8 items-center justify-center rounded-full bg-muted">
											<UserIcon class="size-4" />
										</div>
									{/if}
									{user.name || 'Unnamed'}
								</div>
							</Table.Cell>
							<Table.Cell>{user.email}</Table.Cell>
							<Table.Cell>
								<Badge variant={user.role === 'admin' ? 'default' : 'secondary'}>
									{user.role}
								</Badge>
							</Table.Cell>
							<Table.Cell>
								{#if user.banned}
									<Badge variant="destructive">
										<T keyName="admin.users.banned" />
									</Badge>
								{:else if user.emailVerified}
									<Badge variant="outline" class="border-green-600 text-green-600">
										<T keyName="admin.users.verified" />
									</Badge>
								{:else}
									<Badge variant="outline">
										<T keyName="admin.users.unverified" />
									</Badge>
								{/if}
							</Table.Cell>
							<Table.Cell>{formatDate(user.createdAt)}</Table.Cell>
							<Table.Cell>
								<DropdownMenu.Root>
									<DropdownMenu.Trigger>
										{#snippet child({ props })}
											<Button variant="ghost" size="icon" {...props}>
												<DotsVerticalIcon class="size-4" />
											</Button>
										{/snippet}
									</DropdownMenu.Trigger>
									<DropdownMenu.Content align="end">
										<DropdownMenu.Item onclick={() => impersonateUser(user.id)}>
											<UserCheckIcon class="mr-2 size-4" />
											<T keyName="admin.actions.impersonate" />
										</DropdownMenu.Item>
										<!-- Role management submenu - generated from USER_ROLES enum (hidden for current user) -->
										{#if !isCurrentUser(user.id)}
											<DropdownMenu.Separator />
											<DropdownMenu.Sub>
												<DropdownMenu.SubTrigger>
													<ShieldIcon class="mr-2 size-4" />
													<T keyName="admin.actions.set_role" />
												</DropdownMenu.SubTrigger>
												<DropdownMenu.SubContent>
													{#each USER_ROLES as role}
														<DropdownMenu.Item
															onclick={() => openRoleDialog(user, role)}
															disabled={user.role === role}
														>
															{role}
															{#if user.role === role}
																<CheckIcon class="ml-2 size-4" />
															{/if}
														</DropdownMenu.Item>
													{/each}
												</DropdownMenu.SubContent>
											</DropdownMenu.Sub>
										{/if}
										<DropdownMenu.Separator />
										{#if user.banned}
											<DropdownMenu.Item onclick={() => openDialog(user, 'unban')}>
												<UserCheckIcon class="mr-2 size-4" />
												<T keyName="admin.actions.unban" />
											</DropdownMenu.Item>
										{:else}
											<DropdownMenu.Item
												onclick={() => openDialog(user, 'ban')}
												class="text-destructive"
											>
												<UserOffIcon class="mr-2 size-4" />
												<T keyName="admin.actions.ban" />
											</DropdownMenu.Item>
										{/if}
										<DropdownMenu.Item onclick={() => openDialog(user, 'revoke')}>
											<LogoutIcon class="mr-2 size-4" />
											<T keyName="admin.actions.revoke_sessions" />
										</DropdownMenu.Item>
									</DropdownMenu.Content>
								</DropdownMenu.Root>
							</Table.Cell>
						</Table.Row>
					{/each}
				{:else}
					<Table.Row>
						<Table.Cell colspan={6} class="py-8 text-center text-muted-foreground">
							<T keyName="admin.users.loading" />
						</Table.Cell>
					</Table.Row>
				{/if}
			</Table.Body>
		</Table.Root>
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
