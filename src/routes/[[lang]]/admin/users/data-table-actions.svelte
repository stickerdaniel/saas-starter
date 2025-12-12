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
	import DotsVerticalIcon from '@tabler/icons-svelte/icons/dots-vertical';
	import UserCheckIcon from '@tabler/icons-svelte/icons/user-check';
	import UserOffIcon from '@tabler/icons-svelte/icons/user-off';
	import LogoutIcon from '@tabler/icons-svelte/icons/logout';
	import ShieldIcon from '@tabler/icons-svelte/icons/shield';
	import CheckIcon from '@tabler/icons-svelte/icons/check';
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
		onAction({ type: 'impersonate', userId: user.id });
	}

	function handleSetRole(role: UserRole) {
		onAction({ type: 'openRoleDialog', user, role });
	}

	function handleBan() {
		onAction({ type: 'openBanDialog', user });
	}

	function handleUnban() {
		onAction({ type: 'openUnbanDialog', user });
	}

	function handleRevoke() {
		onAction({ type: 'openRevokeDialog', user });
	}
</script>

<DropdownMenu.Root>
	<DropdownMenu.Trigger>
		{#snippet child({ props })}
			<Button variant="ghost" size="icon" {...props}>
				<DotsVerticalIcon class="size-4" />
				<span class="sr-only">Open menu</span>
			</Button>
		{/snippet}
	</DropdownMenu.Trigger>
	<DropdownMenu.Content align="end">
		<DropdownMenu.Item onclick={handleImpersonate}>
			<UserCheckIcon class="mr-2 size-4" />
			<T keyName="admin.actions.impersonate" />
		</DropdownMenu.Item>
		<!-- Role management submenu - hidden for current user -->
		{#if !isCurrentUser}
			<DropdownMenu.Separator />
			<DropdownMenu.Sub>
				<DropdownMenu.SubTrigger>
					<ShieldIcon class="mr-2 size-4" />
					<T keyName="admin.actions.set_role" />
				</DropdownMenu.SubTrigger>
				<DropdownMenu.SubContent>
					{#each USER_ROLES as role (role)}
						<DropdownMenu.Item onclick={() => handleSetRole(role)} disabled={user.role === role}>
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
			<DropdownMenu.Item onclick={handleUnban}>
				<UserCheckIcon class="mr-2 size-4" />
				<T keyName="admin.actions.unban" />
			</DropdownMenu.Item>
		{:else}
			<DropdownMenu.Item onclick={handleBan} class="text-destructive">
				<UserOffIcon class="mr-2 size-4" />
				<T keyName="admin.actions.ban" />
			</DropdownMenu.Item>
		{/if}
		<DropdownMenu.Item onclick={handleRevoke}>
			<LogoutIcon class="mr-2 size-4" />
			<T keyName="admin.actions.revoke_sessions" />
		</DropdownMenu.Item>
	</DropdownMenu.Content>
</DropdownMenu.Root>
