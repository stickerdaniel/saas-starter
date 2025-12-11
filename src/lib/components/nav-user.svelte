<script lang="ts">
	import * as Avatar from '$lib/components/ui/avatar/index.js';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js';
	import * as Sidebar from '$lib/components/ui/sidebar/index.js';
	import { useSidebar } from '$lib/components/ui/sidebar/index.js';
	import { authClient } from '$lib/auth-client';
	import { goto } from '$app/navigation';
	import BellIcon from '@lucide/svelte/icons/bell';
	import ChevronsUpDownIcon from '@lucide/svelte/icons/chevrons-up-down';
	import CreditCardIcon from '@lucide/svelte/icons/credit-card';
	import LogOutIcon from '@lucide/svelte/icons/log-out';
	import SparklesIcon from '@lucide/svelte/icons/sparkles';
	import SettingsIcon from '@lucide/svelte/icons/settings';
	import UserXIcon from '@lucide/svelte/icons/user-x';
	import { T } from '@tolgee/svelte';
	import { localizedHref } from '$lib/utils/i18n';
	import { toast } from 'svelte-sonner';

	interface Props {
		user: { name: string; email: string; avatar: string };
		isImpersonating?: boolean;
	}

	let { user, isImpersonating = false }: Props = $props();
	const sidebar = useSidebar();

	async function signOut() {
		const result = await authClient.signOut();
		if (result.error) {
			console.error('Sign out error:', result.error);
		} else {
			await goto(localizedHref('/'));
		}
	}

	async function stopImpersonating() {
		try {
			const result = await authClient.admin.stopImpersonating();
			if (result.error) {
				toast.error('Failed to stop impersonation');
				return;
			}
			toast.success('Stopped impersonating');
			goto(localizedHref('/admin/users'));
		} catch (error) {
			toast.error('Failed to stop impersonation');
		}
	}
</script>

{#if isImpersonating}
	<div
		class="bg-warning/10 text-warning border-warning/20 mb-2 rounded-md border px-3 py-2 text-xs font-medium"
	>
		<T keyName="app.user_menu.impersonating_banner" />
	</div>
{/if}
<Sidebar.Menu>
	<Sidebar.MenuItem>
		<DropdownMenu.Root>
			<DropdownMenu.Trigger id="user-menu-trigger">
				{#snippet child({ props })}
					<Sidebar.MenuButton
						size="lg"
						class="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground {isImpersonating
							? 'ring-warning ring-2'
							: ''}"
						{...props}
					>
						<Avatar.Root class="size-8 rounded-lg">
							<Avatar.Image src={user.avatar} alt={user.name} />
							<Avatar.Fallback class="rounded-lg">CN</Avatar.Fallback>
						</Avatar.Root>
						<div class="grid flex-1 text-left text-sm leading-tight">
							<span class="truncate font-medium">{user.name}</span>
							<span class="truncate text-xs">{user.email}</span>
						</div>
						<ChevronsUpDownIcon class="ml-auto size-4" />
					</Sidebar.MenuButton>
				{/snippet}
			</DropdownMenu.Trigger>
			<DropdownMenu.Content
				class="w-(--bits-dropdown-menu-anchor-width) min-w-56 rounded-lg"
				side={sidebar.isMobile ? 'bottom' : 'right'}
				align="end"
				sideOffset={4}
			>
				<DropdownMenu.Label class="p-0 font-normal">
					<div class="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
						<Avatar.Root class="size-8 rounded-lg">
							<Avatar.Image src={user.avatar} alt={user.name} />
							<Avatar.Fallback class="rounded-lg">CN</Avatar.Fallback>
						</Avatar.Root>
						<div class="grid flex-1 text-left text-sm leading-tight">
							<span class="truncate font-medium">{user.name}</span>
							<span class="truncate text-xs">{user.email}</span>
						</div>
					</div>
				</DropdownMenu.Label>
				<DropdownMenu.Separator />
				<DropdownMenu.Group>
					<DropdownMenu.Item>
						<SparklesIcon />
						<T keyName="app.user_menu.upgrade_pro" />
					</DropdownMenu.Item>
				</DropdownMenu.Group>
				<DropdownMenu.Separator />
				<DropdownMenu.Group>
					<a href={localizedHref('/app/settings')}>
						<DropdownMenu.Item>
							<SettingsIcon />
							<T keyName="app.user_menu.settings" />
						</DropdownMenu.Item>
					</a>
					<DropdownMenu.Item>
						<CreditCardIcon />
						<T keyName="app.user_menu.billing" />
					</DropdownMenu.Item>
					<DropdownMenu.Item>
						<BellIcon />
						<T keyName="app.user_menu.notifications" />
					</DropdownMenu.Item>
				</DropdownMenu.Group>
				{#if isImpersonating}
					<DropdownMenu.Separator />
					<DropdownMenu.Item onclick={() => stopImpersonating()} class="text-warning">
						<UserXIcon />
						<T keyName="app.user_menu.stop_impersonating" />
					</DropdownMenu.Item>
				{/if}
				<DropdownMenu.Separator />
				<DropdownMenu.Item onclick={() => signOut()} data-testid="logout-button">
					<LogOutIcon />
					<T keyName="app.user_menu.logout" />
				</DropdownMenu.Item>
			</DropdownMenu.Content>
		</DropdownMenu.Root>
	</Sidebar.MenuItem>
</Sidebar.Menu>
