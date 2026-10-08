<script lang="ts">
	import * as DropdownMenu from '#lib/components/ui/dropdown-menu/index.js';
	import * as Sidebar from '#lib/components/ui/sidebar/index.js';
	import NavUserTrigger from '#lib/components/ui/owned/nav-user-trigger.svelte';
	import UserAvatar from '#lib/components/user-avatar.svelte';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import { useSidebar } from '#lib/components/ui/sidebar/index.js';
	import { authClient } from '#lib/auth-client.js';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import LoaderCircleIcon from '@lucide/svelte/icons/loader-circle';
	import ChevronsUpDownIcon from '@lucide/svelte/icons/chevrons-up-down';
	import CreditCardIcon from '@lucide/svelte/icons/credit-card';
	import LogOutIcon from '@lucide/svelte/icons/log-out';
	import SparklesIcon from '@lucide/svelte/icons/sparkles';
	import SettingsIcon from '@lucide/svelte/icons/settings';
	import UserXIcon from '@lucide/svelte/icons/user-x';
	import { T, getTranslate } from '@tolgee/svelte';
	import { localizedHref } from '#lib/utils/i18n.js';
	import { haptic } from '#lib/hooks/use-haptic.svelte.ts';
	import { impersonationContext } from '#lib/hooks/use-impersonation.svelte.ts';
	import { toast } from 'svelte-sonner';
	import { useCustomer, useAutumnOperation } from '@stickerdaniel/convex-autumn-svelte/sveltekit';
	import { activeUploadsContext } from '#lib/hooks/active-uploads.svelte.ts';
	import { useBillingCheckout } from '#lib/components/billing/index.js';
	import { clearPersistedChatState } from '#lib/chat/core/chat-persisted-state.ts';
	import { duringAuthChange } from '#lib/analytics/client.js';

	const { t } = getTranslate();

	// Consulted before navigations this component starts on the user's behalf,
	// so an in-flight upload elsewhere on the page cannot stop them.
	const activeUploads = activeUploadsContext.getOr(null);

	interface Props {
		user: { name: string; email: string; avatar: string };
	}

	let { user }: Props = $props();
	const sidebar = useSidebar();

	// Impersonation state comes from the live session, not a parent prop: while an
	// admin impersonates a user the session carries impersonatedBy, so the app
	// shell reads it directly to show the Stop control. The root layout owns it,
	// so this control and the investigation bar share one exit.
	const impersonation = impersonationContext.get();

	// Autumn subscription state
	const autumn = useCustomer();
	const billingCheckout = useBillingCheckout();
	const billingUsable = $derived(billingCheckout.isUsable);
	const portalOperation = useAutumnOperation(autumn.openBillingPortal);
	const isPro = $derived(autumn.customer?.products?.some((p) => p.id === 'pro') ?? false);

	async function handleUpgrade() {
		haptic.trigger('light');
		const successUrl = new URL(localizedHref('/app/community-chat'), page.url.origin);
		successUrl.searchParams.set('upgraded', 'true');
		await billingCheckout.start({ productId: 'pro', successUrl: successUrl.href });
	}

	async function handleBilling() {
		if (!billingUsable) {
			haptic.trigger('error');
			toast.error($t('capabilities.billing_unavailable'));
			return;
		}
		haptic.trigger('light');
		// Return here after the portal; without returnUrl Autumn defaults to useautumn.com.
		await portalOperation.execute({ returnUrl: window.location.href });
		if (portalOperation.error) {
			haptic.trigger('error');
			toast.error($t('billing.portal_failed'));
			console.error('Billing portal failed:', portalOperation.error);
		}
	}

	async function signOut() {
		haptic.trigger('light');
		const result = await duringAuthChange(
			() => authClient.signOut(),
			(result) => !result.error
		);
		if (result.error) {
			console.error('Sign out error:', result.error);
			toast.error($t('common.error'));
		} else {
			// The session is already gone. Stopping this would strand the user on a
			// signed-out page, so an upload does not get a say.
			activeUploads?.suspendOnce();
			// Drafts and attachments belong to the person who wrote them, and this
			// browser is about to belong to whoever signs in next.
			clearPersistedChatState();
			await goto(resolve(localizedHref('/')));
		}
	}
</script>

<Sidebar.Menu>
	<Sidebar.MenuItem>
		<DropdownMenu.Root>
			<DropdownMenu.Trigger id="user-menu-trigger">
				{#snippet child({ props })}
					<NavUserTrigger impersonating={impersonation.isImpersonating} {...props}>
						<UserAvatar
							name={user.name}
							email={user.email}
							image={user.avatar}
							alt={user.name}
							shape="square"
						/>
						<div class="grid flex-1 text-left text-sm leading-tight">
							<span class="truncate font-medium">{user.name}</span>
							<span class="truncate text-xs">{user.email}</span>
						</div>
						<ChevronsUpDownIcon class="ml-auto size-4" />
					</NavUserTrigger>
				{/snippet}
			</DropdownMenu.Trigger>
			<DropdownMenu.Content
				class="w-(--bits-dropdown-menu-anchor-width) min-w-56 rounded-lg"
				side={sidebar.isMobile ? 'bottom' : 'right'}
				align="end"
				sideOffset={4}
			>
				<!-- A plain wrapper keeps the menu label's muted color, small type and normal
				     weight for the user row, without the label's padding. -->
				<div class="text-xs font-normal text-muted-foreground">
					<div class="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
						<UserAvatar
							name={user.name}
							email={user.email}
							image={user.avatar}
							alt={user.name}
							shape="square"
						/>
						<div class="grid flex-1 text-left text-sm leading-tight">
							<span class="flex min-w-0 items-center gap-1.5 font-medium">
								<span class="truncate">{user.name}</span>
								{#if isPro}
									<Badge variant="premium" class="shrink-0">
										<T keyName="app.user_menu.pro_badge" />
									</Badge>
								{/if}
							</span>
							<span class="truncate text-xs">{user.email}</span>
						</div>
					</div>
				</div>
				<DropdownMenu.Separator />
				{#if !isPro}
					<DropdownMenu.Group>
						<DropdownMenu.Item
							onclick={handleUpgrade}
							disabled={!billingUsable || billingCheckout.isLoading}
							title={!billingUsable ? $t('capabilities.billing_unavailable') : undefined}
						>
							{#if billingCheckout.isLoading}
								<LoaderCircleIcon class="motion-safe:animate-spin" />
							{:else}
								<SparklesIcon />
							{/if}
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
					<DropdownMenu.Item
						onclick={handleBilling}
						disabled={!billingUsable || portalOperation.isLoading}
						title={!billingUsable ? $t('capabilities.billing_unavailable') : undefined}
					>
						{#if portalOperation.isLoading}
							<LoaderCircleIcon class="motion-safe:animate-spin" />
						{:else}
							<CreditCardIcon />
						{/if}
						<T keyName="app.user_menu.billing" />
					</DropdownMenu.Item>
				</DropdownMenu.Group>
				<DropdownMenu.Separator />
				<!-- While impersonating, signing out would end the impersonated user's session
				     and leave the admin logged out entirely, so only offer Stop Impersonating.
				     Neither shows until the session resolves, so log out is never live on an
				     unresolved session. -->
				{#if impersonation.isImpersonating}
					<DropdownMenu.Item
						onclick={() => impersonation.stop($t)}
						class="text-warning"
						data-testid="app-user-menu-stop-impersonating"
					>
						<UserXIcon />
						<T keyName="app.user_menu.stop_impersonating" />
					</DropdownMenu.Item>
				{:else if impersonation.canSignOut}
					<DropdownMenu.Item onclick={() => signOut()} data-testid="logout-button">
						<LogOutIcon />
						<T keyName="app.user_menu.logout" />
					</DropdownMenu.Item>
				{/if}
			</DropdownMenu.Content>
		</DropdownMenu.Root>
	</Sidebar.MenuItem>
</Sidebar.Menu>
