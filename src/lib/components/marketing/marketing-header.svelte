<script lang="ts">
	import LightSwitch from '$lib/components/ui/light-switch/light-switch.svelte';
	import LanguageSwitcher from '$lib/components/LanguageSwitcher.svelte';
	import CommandTrigger from '$lib/components/global-search/command-trigger.svelte';
	import Button from '$lib/components/ui/button/button.svelte';
	import { cn } from '$lib/utils';
	import { localizedHref } from '$lib/utils/i18n';
	import { resolve } from '$app/paths';
	import Menu from '@lucide/svelte/icons/menu';
	import X from '@lucide/svelte/icons/x';
	import LogOut from '@lucide/svelte/icons/log-out';
	import Github from '@lucide/svelte/icons/github';
	import Logo from '$lib/components/icons/logo.svelte';
	import { useAuth } from '@mmailaender/convex-better-auth-svelte/svelte';
	import { authClient } from '$lib/auth-client';
	import { T, getTranslate } from '@tolgee/svelte';

	const { t } = getTranslate();

	const auth = useAuth();

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
				class="-mx-2 flex w-[calc(100%+1rem)] items-center justify-between rounded-2xl border border-black/[0.06] px-6 py-4 [box-shadow:inset_0_1px_1px_0_rgba(255,255,255,0.5)] backdrop-blur-[5px] transition-[height,transform] duration-300 [background:linear-gradient(137deg,rgba(252,252,255,0.9)_4.87%,rgba(240,240,248,0.95)_75.88%)] lg:-mx-8 lg:w-[calc(100%+4rem)] lg:px-8 dark:border-white/[0.06] dark:[box-shadow:inset_0_1px_1px_0_rgba(255,255,255,0.15)] dark:[background:linear-gradient(137deg,rgba(17,18,20,0.75)_4.87%,rgba(12,13,15,0.9)_75.88%)]"
			>
				<!-- Logo -->
				<a href={resolve(localizedHref('/'))} class="flex items-center space-x-2">
					<Logo class="size-5" />
					<span class="font-semibold">SaaS Starter</span>
				</a>

				<!-- Desktop Navigation -->
				<ul class="hidden gap-8 text-sm lg:flex">
					{#each menuItems as item (item.translationKey)}
						<li>
							<a
								href={resolve(item.href)}
								class="block text-muted-foreground duration-150 hover:text-accent-foreground"
							>
								<span><T keyName={item.translationKey} /></span>
							</a>
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
					{#if auth.isAuthenticated}
						<Button size="sm" href={localizedHref('/app')}>
							<T keyName="nav.dashboard" />
						</Button>
						<Button
							variant="outline"
							size="icon"
							class="size-8"
							onclick={() => authClient.signOut()}
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
			<ul class="space-y-4 text-base">
				{#each menuItems as item (item.translationKey)}
					<li>
						<a
							href={resolve(item.href)}
							class="block text-muted-foreground duration-150 hover:text-accent-foreground"
							onclick={() => (menuState = false)}
						>
							<span><T keyName={item.translationKey} /></span>
						</a>
					</li>
				{/each}
			</ul>
			<div class="mt-6 flex flex-col gap-3">
				{#if auth.isAuthenticated}
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
		</div>
	{/if}
</header>
