<script lang="ts">
	import * as Avatar from '$lib/components/ui/avatar/index.js';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js';
	import * as Sidebar from '$lib/components/ui/sidebar/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { useSidebar } from '$lib/components/ui/sidebar/index.js';
	import { authClient } from '$lib/auth-client';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import ChevronsUpDownIcon from '@lucide/svelte/icons/chevrons-up-down';
	import CreditCardIcon from '@lucide/svelte/icons/credit-card';
	import LogOutIcon from '@lucide/svelte/icons/log-out';
	import SparklesIcon from '@lucide/svelte/icons/sparkles';
	import SettingsIcon from '@lucide/svelte/icons/settings';
	import UserXIcon from '@lucide/svelte/icons/user-x';
	import { T, getTranslate } from '@tolgee/svelte';
	import { localizedHref } from '$lib/utils/i18n';
	import { haptic } from '$lib/hooks/use-haptic.svelte';
	import { toast } from 'svelte-sonner';
	import { useCustomer, useAutumnOperation } from '@stickerdaniel/convex-autumn-svelte/sveltekit';

	const { t } = getTranslate();

	interface Props {
		user: { name: string; email: string; avatar: string };
		isImpersonating?: boolean;
	}

	let { user, isImpersonating = false }: Props = $props();
	const sidebar = useSidebar();

	// Autumn subscription state
	const autumn = useCustomer();
	const upgradeOperation = useAutumnOperation(autumn.checkout);
	const portalOperation = useAutumnOperation(autumn.openBillingPortal);
	const isPro = $derived(autumn.customer?.products?.some((p) => p.id === 'pro') ?? false);

	const initials = $derived(
		(user.name ?? '')
			.trim()
			.split(/\s+/)
			.filter(Boolean)
			.map((n) => n[0])
			.join('')
			.toUpperCase()
			.slice(0, 2) || '?'
	);

	async function handleUpgrade() {
		haptic.trigger('light');
		const result = await upgradeOperation.execute({
			productId: 'pro',
			successUrl: page.url.origin + '/app/community-chat?upgraded=true'
		});
		if (result?.url) {
			window.location.href = result.url;
		}
	}

	async function handleBilling() {
		haptic.trigger('light');
		const result = await portalOperation.execute({});
		if (result?.url) {
			window.location.href = result.url;
		}
	}

	async function signOut() {
		haptic.trigger('light');
		const result = await authClient.signOut();
		if (result.error) {
			console.error('Sign out error:', result.error);
			toast.error($t('common.error'));
		} else {
			await goto(resolve(localizedHref('/')));
		}
	}

	async function stopImpersonating() {
		haptic.trigger('warning');
		try {
			const result = await authClient.admin.stopImpersonating();
			if (result.error) {
				toast.error($t('app.user_menu.impersonation_stop_failed'));
				return;
			}
			toast.success($t('app.user_menu.impersonation_stopped'));
			goto(resolve(localizedHref('/admin/users')));
		} catch {
			toast.error($t('app.user_menu.impersonation_stop_failed'));
		}
	}
</script>

{#if isImpersonating}
	<div
		class="mb-2 rounded-md border border-warning/20 bg-warning/10 px-3 py-2 text-xs font-medium text-warning"
	>
		<T keyName="app.user_menu.impersonating_banner" />
	</div>
{/if}
<Sidebar.Menu>
	<Sidebar.MenuItem>
		<DropdownMenu.Root>
			<DropdownMenu.Trigger id="user-menu-trigger">
				{#snippet child({ props })}
					<Button
						variant="ghost"
						class="h-12 w-full justify-start gap-2 px-2 data-[state=open]:bg-muted {isImpersonating
							? 'ring-2 ring-warning'
							: ''}"
						{...props}
					>
						<Avatar.Root class="size-8 rounded-lg">
							<Avatar.Image src={user.avatar} alt={user.name} />
							<Avatar.Fallback class="rounded-lg">{initials}</Avatar.Fallback>
						</Avatar.Root>
						<div class="grid flex-1 text-left text-sm leading-tight">
							<span class="truncate font-medium">{user.name}</span>
							<span class="truncate text-xs">{user.email}</span>
						</div>
						<ChevronsUpDownIcon class="ml-auto size-4" />
					</Button>
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
							<Avatar.Fallback class="rounded-lg">{initials}</Avatar.Fallback>
						</Avatar.Root>
						<div class="grid flex-1 text-left text-sm leading-tight">
							<span class="flex items-center gap-1.5 truncate font-medium">
								{user.name}
								{#if isPro}
									<Badge
										class="h-auto bg-purple-500/15 px-1.5 py-0.5 text-[10px] leading-none text-purple-400"
									>
										<T keyName="app.user_menu.pro_badge" />
									</Badge>
								{/if}
							</span>
							<span class="truncate text-xs">{user.email}</span>
						</div>
					</div>
				</DropdownMenu.Label>
				<DropdownMenu.Separator />
				{#if !isPro}
					<DropdownMenu.Group>
						<DropdownMenu.Item onclick={handleUpgrade} disabled={upgradeOperation.isLoading}>
							<SparklesIcon />
							<T keyName="app.user_menu.upgrade_pro" />
						</DropdownMenu.Item>
					</DropdownMenu.Group>
					<DropdownMenu.Separator />
				{/if}
				<DropdownMenu.Group>
					<a href={resolve(localizedHref('/app/settings'))}>
						<DropdownMenu.Item>
							<SettingsIcon />
							<T keyName="app.user_menu.settings" />
						</DropdownMenu.Item>
					</a>
					<DropdownMenu.Item onclick={handleBilling} disabled={portalOperation.isLoading}>
						<CreditCardIcon />
						<T keyName="app.user_menu.billing" />
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
