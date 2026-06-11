<script lang="ts" module>
	import type { AdminUserData, UserRole } from '$lib/convex/admin/types';

	export type ActionEvent =
		| { type: 'impersonate'; userId: string }
		| { type: 'openRoleDialog'; user: AdminUserData; role: UserRole }
		| { type: 'openBanDialog'; user: AdminUserData }
		| { type: 'openUnbanDialog'; user: AdminUserData }
		| { type: 'openRevokeDialog'; user: AdminUserData };
</script>

<script lang="ts">
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import DotsVerticalIcon from '@lucide/svelte/icons/ellipsis-vertical';
	import UserCheckIcon from '@lucide/svelte/icons/user-check';
	import UserOffIcon from '@lucide/svelte/icons/user-x';
	import LogoutIcon from '@lucide/svelte/icons/log-out';
	import ShieldIcon from '@lucide/svelte/icons/shield';
	import CheckIcon from '@lucide/svelte/icons/check';
	import { haptic } from '$lib/hooks/use-haptic.svelte';
	import { T } from '@tolgee/svelte';
	import { USER_ROLES } from '$lib/convex/admin/types';
	import { getContext } from 'svelte';

	type Props = {
		user: AdminUserData;
	};

	let { user }: Props = $props();

	// Get current viewer ID from context to prevent self-modification
	const currentUserId = getContext<string>('currentUserId');

	// Get action handler from context
	const onAction = getContext<(event: ActionEvent) => void>('onUserAction');

	const isCurrentUser = $derived(currentUserId === user.id);

	function handleImpersonate() {
		haptic.trigger('light');
		onAction({ type: 'impersonate', userId: user.id });
	}

	function handleSetRole(role: UserRole) {
		haptic.trigger('light');
		onAction({ type: 'openRoleDialog', user, role });
	}

	function handleBan() {
		haptic.trigger('warning');
		onAction({ type: 'openBanDialog', user });
	}

	function handleUnban() {
		haptic.trigger('light');
		onAction({ type: 'openUnbanDialog', user });
	}

	function handleRevoke() {
		haptic.trigger('warning');
		onAction({ type: 'openRevokeDialog', user });
	}
</script>

<DropdownMenu.Root>
	<DropdownMenu.Trigger>
		{#snippet child({ props })}
			<Button variant="ghost" size="icon" data-testid="admin-users-row-actions" {...props}>
				<DotsVerticalIcon class="size-4" />
				<span class="sr-only"><T keyName="admin.users.menu_open" /></span>
			</Button>
		{/snippet}
	</DropdownMenu.Trigger>
	<DropdownMenu.Content align="end">
		<DropdownMenu.Item onclick={handleImpersonate} data-testid="admin-users-action-impersonate">
			<UserCheckIcon class="mr-2 size-4" />
			<T keyName="admin.actions.impersonate" />
		</DropdownMenu.Item>
		<!-- Role management submenu - hidden for current user -->
		{#if !isCurrentUser}
			<DropdownMenu.Separator />
			<DropdownMenu.Sub>
				<DropdownMenu.SubTrigger data-testid="admin-users-action-set-role">
					<ShieldIcon class="mr-2 size-4" />
					<T keyName="admin.actions.set_role" />
				</DropdownMenu.SubTrigger>
				<DropdownMenu.SubContent>
					{#each USER_ROLES as role (role)}
						<DropdownMenu.Item
							onclick={() => handleSetRole(role)}
							disabled={user.role === role}
							data-testid="admin-users-action-role-{role}"
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
			<DropdownMenu.Item onclick={handleUnban} data-testid="admin-users-action-unban">
				<UserCheckIcon class="mr-2 size-4" />
				<T keyName="admin.actions.unban" />
			</DropdownMenu.Item>
		{:else}
			<DropdownMenu.Item
				onclick={handleBan}
				class="text-destructive"
				data-testid="admin-users-action-ban"
			>
				<UserOffIcon class="mr-2 size-4" />
				<T keyName="admin.actions.ban" />
			</DropdownMenu.Item>
		{/if}
		<DropdownMenu.Item onclick={handleRevoke} data-testid="admin-users-action-revoke-sessions">
			<LogoutIcon class="mr-2 size-4" />
			<T keyName="admin.actions.revoke_sessions" />
		</DropdownMenu.Item>
	</DropdownMenu.Content>
</DropdownMenu.Root>
