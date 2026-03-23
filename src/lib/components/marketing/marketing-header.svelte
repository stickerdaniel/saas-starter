<script lang="ts">
	import CommandTrigger from '$lib/components/global-search/command-trigger.svelte';
	import LightSwitch from '$lib/components/ui/light-switch/light-switch.svelte';
	import LanguageSwitcher from '$lib/components/LanguageSwitcher.svelte';
	import Button from '$lib/components/ui/button/button.svelte';
	import { cn } from '$lib/utils';
	import { localizedHref } from '$lib/utils/i18n';
	import { resolve } from '$app/paths';
	import { goto } from '$app/navigation';
	import Menu from '@lucide/svelte/icons/menu';
	import X from '@lucide/svelte/icons/x';
	import LogOut from '@lucide/svelte/icons/log-out';
	import Github from '@lucide/svelte/icons/github';
	import Logo from '$lib/components/icons/logo.svelte';
	import { authClient } from '$lib/auth-client';
	import { useAuth } from '@mmailaender/convex-better-auth-svelte/svelte';
	import { T, getTranslate } from '@tolgee/svelte';

	const { t } = getTranslate();
	const auth = useAuth();
	let signingOut = $state(false);
	const isAuthenticated = $derived(auth.isAuthenticated && !signingOut);

	// Capture once at mount: did the server have a valid JWT?
	const ssrAuthenticated = auth.isAuthenticated;

	// Check if a session cookie exists (may need refresh → wait for result).
	// No session cookie = definitely unauthenticated → show buttons instantly.
	const hasSessionCookie =
		typeof document !== 'undefined' && document.cookie.includes('better-auth.session_token');

	let sessionChecked = $state(false);
	$effect(() => {
		const unsub = authClient.useSession().subscribe((s) => {
			if (!s.isPending) sessionChecked = true;
		});
		return unsub;
	});

	// SSR authenticated: show immediately (server knew auth state).
	// No session cookie: show immediately (definitely unauthenticated).
	// Session cookie but no JWT: wait for refresh to avoid Login→Dashboard flash.
	const showAuthButtons = $derived(
		ssrAuthenticated || !hasSessionCookie || (sessionChecked && !auth.isLoading)
	);

	async function signOut() {
		signingOut = true;
		const result = await authClient.signOut();
		if (!result.error) {
			await goto(resolve(localizedHref('/')));
		} else {
			signingOut = false;
		}
	}

	// Scroll detection for button swap
	let scrollY = $state(0);
	const isAtTop = $derived(scrollY < 10);

	// $derived menu items (href must update on lang switch)
	let menuItems = $derived([
		{ translationKey: 'nav.home', href: localizedHref('/') },
		{ translationKey: 'nav.pricing', href: localizedHref('/pricing') },
		{ translationKey: 'nav.about', href: localizedHref('/about') }
	]);

	let menuState = $state(false);
</script>

<svelte:window bind:scrollY />

<header>
	<nav class="fixed z-40 w-full pt-4">
		<div class="mx-auto max-w-6xl px-6 lg:px-12">
			<div
				class="-mx-2 flex w-[calc(100%+1rem)] items-center justify-between rounded-2xl border marketing-shell-panel px-6 py-4 transition-[height,transform,background-color,border-color] duration-300 lg:-mx-8 lg:w-[calc(100%+4rem)] lg:px-8"
			>
				<!-- Logo -->
				<Button
					variant="ghost"
					href={resolve(localizedHref('/'))}
					class="-ml-3.5 flex items-center gap-2 px-3 font-semibold"
				>
					<Logo class="size-5" />
					SaaS Starter
				</Button>

				<!-- Desktop Navigation -->
				<ul class="hidden gap-2 text-sm lg:flex">
					{#each menuItems as item (item.translationKey)}
						<li>
							<Button
								variant="ghost"
								size="sm"
								href={resolve(item.href)}
								class="text-muted-foreground"
							>
								<T keyName={item.translationKey} />
							</Button>
						</li>
					{/each}
				</ul>

				<!-- Desktop Actions -->
				<div class="hidden items-center gap-3 lg:flex">
					<CommandTrigger />
					<Button
						variant="ghost"
						size="icon"
						href="https://github.com/stickerdaniel/saas-starter"
						target="_blank"
						rel="noopener noreferrer"
						aria-label={$t('aria.github_repository')}
						class="size-8"
					>
						<Github class="size-4" />
					</Button>
					<LightSwitch variant="ghost" />
					<LanguageSwitcher variant="ghost" />
					<div class="relative flex items-center">
						<!-- Spacer: always reserves width of widest button combo -->
						<div class="pointer-events-none invisible flex items-center gap-3" aria-hidden="true">
							<Button variant="ghost" size="sm" tabindex={-1}>
								<T keyName="nav.login" />
							</Button>
							<Button size="sm" tabindex={-1}>
								<T keyName="nav.signup" />
							</Button>
						</div>
						{#if showAuthButtons}
							<div
								class={cn(
									'absolute inset-y-0 right-0 flex items-center gap-3',
									!ssrAuthenticated && hasSessionCookie && 'motion-safe:animate-fade-in'
								)}
							>
								{#if isAuthenticated}
									<Button size="sm" href={localizedHref('/app')}>
										<T keyName="nav.dashboard" />
									</Button>
									<Button
										variant="outline"
										size="icon"
										class="size-8"
										onclick={() => signOut()}
										aria-label={$t('aria.logout')}
									>
										<LogOut class="size-4" />
									</Button>
								{:else if isAtTop}
									<Button variant="ghost" size="sm" href={localizedHref('/signin')}>
										<T keyName="nav.login" />
									</Button>
									<Button size="sm" href={localizedHref('/signin?tab=signup')}>
										<T keyName="nav.signup" />
									</Button>
								{:else}
									<Button size="sm" href={localizedHref('/signin?tab=signup')}>
										<T keyName="nav.get_started" />
									</Button>
								{/if}
							</div>
						{/if}
					</div>
				</div>

				<!-- Mobile Menu Button -->
				<div class="flex items-center gap-1 lg:hidden">
					<Button
						variant="ghost"
						size="icon"
						href="https://github.com/stickerdaniel/saas-starter"
						target="_blank"
						rel="noopener noreferrer"
						aria-label={$t('aria.github_repository')}
						class="size-8"
					>
						<Github class="size-4" />
					</Button>
					<LightSwitch variant="ghost" />
					<LanguageSwitcher variant="ghost" />
					<button
						onclick={() => (menuState = !menuState)}
						aria-label={menuState ? $t('aria.menu_close') : $t('aria.menu_open')}
						class="relative z-20 -m-2.5 -mr-4 block cursor-pointer p-2.5 pl-4"
					>
						<Menu
							class={cn('m-auto size-6 duration-200', menuState && 'scale-0 rotate-180 opacity-0')}
						/>
						<X
							class={cn(
								'absolute inset-0 m-auto size-6 scale-0 -rotate-180 opacity-0 duration-200',
								menuState && 'scale-100 rotate-0 opacity-100'
							)}
						/>
					</button>
				</div>
			</div>
		</div>
	</nav>

	<!-- Mobile Menu Dropdown -->
	{#if menuState}
		<div
			class="fixed top-24 right-4 left-4 z-30 rounded-2xl border border-white/[0.06] bg-background/95 p-6 backdrop-blur-xl lg:hidden"
		>
			<ul class="space-y-1 text-base">
				{#each menuItems as item (item.translationKey)}
					<li>
						<Button
							variant="ghost"
							href={resolve(item.href)}
							class="w-full justify-start text-muted-foreground"
							onclick={() => (menuState = false)}
						>
							<T keyName={item.translationKey} />
						</Button>
					</li>
				{/each}
			</ul>
			<div class="mt-6 flex flex-col gap-3">
				{#if showAuthButtons}
					<div
						class={cn(
							'flex flex-col gap-3',
							!ssrAuthenticated && hasSessionCookie && 'motion-safe:animate-fade-in'
						)}
					>
						{#if isAuthenticated}
							<Button size="sm" href={localizedHref('/app')} class="w-full">
								<T keyName="nav.dashboard" />
							</Button>
						{:else if isAtTop}
							<Button variant="ghost" size="sm" href={localizedHref('/signin')} class="w-full">
								<T keyName="nav.login" />
							</Button>
							<Button size="sm" href={localizedHref('/signin?tab=signup')} class="w-full">
								<T keyName="nav.signup" />
							</Button>
						{:else}
							<Button size="sm" href={localizedHref('/signin?tab=signup')} class="w-full">
								<T keyName="nav.get_started" />
							</Button>
						{/if}
					</div>
				{/if}
			</div>
		</div>
	{/if}
</header>
