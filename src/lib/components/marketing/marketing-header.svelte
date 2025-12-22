<script lang="ts">
	import LightSwitch from '$lib/components/ui/light-switch/light-switch.svelte';
	import LanguageSwitcher from '$lib/components/LanguageSwitcher.svelte';
	import Button from '$lib/components/ui/button/button.svelte';
	import { cn } from '$lib/utils';
	import { localizedHref } from '$lib/utils/i18n';
	import Menu from '@lucide/svelte/icons/menu';
	import X from '@lucide/svelte/icons/x';
	import LogOut from '@lucide/svelte/icons/log-out';
	import Command from '@lucide/svelte/icons/command';
	import Github from '@lucide/svelte/icons/github';
	import { scrollY } from 'svelte/reactivity/window';
	import { useAuth } from '@mmailaender/convex-better-auth-svelte/svelte';
	import { authClient } from '$lib/auth-client';
	import { T } from '@tolgee/svelte';

	const auth = useAuth();

	// $derived menu items (href must update on lang switch)
	let menuItems = $derived([
		{ translationKey: 'nav.home', href: localizedHref('/') },
		{ translationKey: 'nav.pricing', href: localizedHref('/pricing') },
		{ translationKey: 'nav.about', href: localizedHref('/about') }
	]);

	let menuState = $state(false);
	let isScrolled = $derived((scrollY.current ?? 0) > 50);
</script>

<header>
	<nav class="fixed z-40 w-full">
		<div
			class="mx-auto max-w-6xl rounded-3xl bg-background/50 px-6 shadow-2xl/10 backdrop-blur-2xl lg:px-12 lg:shadow-none"
		>
			<div class="relative flex flex-wrap items-center justify-between gap-6 py-3 lg:gap-0 lg:py-4">
				<div class="flex w-full items-center justify-between gap-12 lg:w-auto">
					<a href={localizedHref('/')} aria-label="home" class="flex items-center space-x-2">
						<Command class="size-5" />
						<span class="font-semibold">SaaS Starter</span>
					</a>

					<!-- Mobile controls group -->
					<div class="flex items-center gap-1 lg:hidden">
						<Button
							variant="ghost"
							size="icon"
							href="https://github.com/stickerdaniel/saas-starter"
							target="_blank"
							rel="noopener noreferrer"
							aria-label="GitHub repository"
							class="size-8"
						>
							<Github class="size-4" />
						</Button>
						<LightSwitch variant="ghost" />
						<LanguageSwitcher variant="ghost" />
						<button
							onclick={() => (menuState = !menuState)}
							aria-label={menuState == true ? 'Close Menu' : 'Open Menu'}
							class="relative z-20 -m-2.5 -mr-4 block cursor-pointer p-2.5 pl-4"
						>
							<Menu
								class={cn(
									'm-auto size-6 duration-200',
									menuState && 'scale-0 rotate-180 opacity-0'
								)}
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

				<div class="absolute inset-0 m-auto hidden size-fit lg:block">
					<ul class="flex gap-8 text-sm">
						{#each menuItems as item}
							<li>
								<a
									href={item.href}
									class="block text-muted-foreground duration-150 hover:text-accent-foreground"
								>
									<span><T keyName={item.translationKey} /></span>
								</a>
							</li>
						{/each}
					</ul>
				</div>

				<div
					class={cn(
						'mb-3 w-full  flex-wrap items-center justify-end space-y-8 rounded-3xl border bg-background p-6 shadow-2xl shadow-zinc-300/20 lg:m-0 lg:flex lg:w-fit lg:flex-nowrap lg:gap-6 lg:space-y-0 lg:border-transparent lg:bg-transparent lg:p-0 lg:shadow-none dark:shadow-none dark:lg:bg-transparent',
						menuState ? 'block lg:flex' : 'hidden lg:flex'
					)}
				>
					<div class="lg:hidden">
						<ul class="space-y-6 text-right text-base">
							{#each menuItems as item}
								<li>
									<a
										href={item.href}
										class="block text-muted-foreground duration-150 hover:text-accent-foreground"
									>
										<span><T keyName={item.translationKey} /></span>
									</a>
								</li>
							{/each}
						</ul>
					</div>
					<div
						class="flex w-full flex-col items-end gap-3 lg:w-fit lg:flex-row lg:items-center lg:space-y-0"
					>
						<!-- Desktop only - mobile controls are in header bar -->
						<div class="hidden lg:flex lg:items-center lg:gap-3">
							<Button
								variant="ghost"
								size="icon"
								href="https://github.com/stickerdaniel/saas-starter"
								target="_blank"
								rel="noopener noreferrer"
								aria-label="GitHub repository"
								class="size-8"
							>
								<Github class="size-4" />
							</Button>
							<LightSwitch variant="ghost" />
							<LanguageSwitcher variant="ghost" />
						</div>
						{#if auth.isAuthenticated}
							<Button size="sm" href={localizedHref('/app')} class="w-full lg:w-auto">
								<T keyName="nav.dashboard" />
							</Button>
							<Button
								variant="outline"
								size="icon"
								class="size-8"
								onclick={() => authClient.signOut()}
							>
								<LogOut class="size-4" />
							</Button>
						{:else}
							<Button
								variant="outline"
								size="sm"
								class={cn('w-full lg:w-auto', isScrolled && 'hidden')}
								href={localizedHref('/signin?tab=signin')}
							>
								<T keyName="auth.login" />
							</Button>
							<Button
								size="sm"
								class={cn('w-full lg:w-auto', isScrolled && 'hidden')}
								href={localizedHref('/signin?tab=signup')}
							>
								<T keyName="auth.signup" />
							</Button>
							<Button
								size="sm"
								class={cn('w-full lg:w-auto', !isScrolled && 'hidden')}
								href={localizedHref('/signin?tab=signup')}
							>
								<T keyName="nav.get_started" />
							</Button>
						{/if}
					</div>
				</div>
			</div>
		</div>
	</nav>
</header>
