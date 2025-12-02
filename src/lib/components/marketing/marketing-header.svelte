<script>
	import LightSwitch from '$lib/components/ui/light-switch/light-switch.svelte';
	import LanguageSwitcher from '$lib/components/LanguageSwitcher.svelte';
	import Button from '$lib/components/ui/button/button.svelte';
	import { cn } from '$lib/utils';
	import { localizedHref } from '$lib/utils/i18n';
	import Menu from '@lucide/svelte/icons/menu';
	import X from '@lucide/svelte/icons/x';
	import LogOut from '@lucide/svelte/icons/log-out';
	import { scrollY } from 'svelte/reactivity/window';
	import { useAuth } from '@mmailaender/convex-auth-svelte/sveltekit';
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
	<nav class="fixed z-40 w-full px-2">
		<div
			class="mx-auto max-w-6xl rounded-3xl bg-background/50 px-6 shadow-2xl/10 backdrop-blur-2xl lg:px-12 lg:shadow-none"
		>
			<div class="relative flex flex-wrap items-center justify-between gap-6 py-3 lg:gap-0 lg:py-4">
				<div class="flex w-full items-center justify-between gap-12 lg:w-auto">
					<a href={localizedHref('/')} aria-label="home" class="flex items-center space-x-2">
						<svg
							xmlns="http://www.w3.org/2000/svg"
							width="22"
							height="22"
							viewBox="0 0 24 24"
							fill="none"
							role="img"
							color="currentColor"
						>
							<path
								d="M22 18C22 19.4001 22 20.1002 21.7275 20.635C21.4878 21.1054 21.1054 21.4878 20.635 21.7275C20.1002 22 19.4001 22 18 22C16.5999 22 15.8998 22 15.365 21.7275C14.8946 21.4878 14.5122 21.1054 14.2725 20.635C14 20.1002 14 19.4001 14 18C14 16.5999 14 15.8998 14.2725 15.365C14.5122 14.8946 14.8946 14.5122 15.365 14.2725C15.8998 14 16.5999 14 18 14C19.4001 14 20.1002 14 20.635 14.2725C21.1054 14.5122 21.4878 14.8946 21.7275 15.365C22 15.8998 22 16.5999 22 18Z"
								stroke="currentColor"
								stroke-width="1.5"
							></path>
							<path
								d="M22 10C22 11.4001 22 12.1002 21.7275 12.635C21.4878 13.1054 21.1054 13.4878 20.635 13.7275C20.1002 14 19.4001 14 18 14C16.5999 14 15.8998 14 15.365 13.7275C14.8946 13.4878 14.5122 13.1054 14.2725 12.635C14 12.1002 14 11.4001 14 10C14 8.59987 14 7.8998 14.2725 7.36502C14.5122 6.89462 14.8946 6.51217 15.365 6.27248C15.8998 6 16.5999 6 18 6C19.4001 6 20.1002 6 20.635 6.27248C21.1054 6.51217 21.4878 6.89462 21.7275 7.36502C22 7.8998 22 8.59987 22 10Z"
								stroke="currentColor"
								stroke-width="1.5"
							></path>
							<path
								d="M14 18C14 19.4001 14 20.1002 13.7275 20.635C13.4878 21.1054 13.1054 21.4878 12.635 21.7275C12.1002 22 11.4001 22 10 22C8.59987 22 7.8998 22 7.36502 21.7275C6.89462 21.4878 6.51217 21.1054 6.27248 20.635C6 20.1002 6 19.4001 6 18C6 16.5999 6 15.8998 6.27248 15.365C6.51217 14.8946 6.89462 14.5122 7.36502 14.2725C7.8998 14 8.59987 14 10 14C11.4001 14 12.1002 14 12.635 14.2725C13.1054 14.5122 13.4878 14.8946 13.7275 15.365C14 15.8998 14 16.5999 14 18Z"
								stroke="currentColor"
								stroke-width="1.5"
							></path>
							<path
								opacity="0.4"
								d="M10 6C10 7.40013 10 8.1002 9.72752 8.63497C9.48783 9.10538 9.10538 9.48783 8.63498 9.72752C8.1002 10 7.40013 10 6 10C4.59987 10 3.8998 10 3.36502 9.72751C2.89462 9.48783 2.51217 9.10538 2.27248 8.63497C2 8.10019 2 7.40013 2 6C2 4.59987 2 3.8998 2.27248 3.36502C2.51217 2.89462 2.89462 2.51217 3.36502 2.27248C3.8998 2 4.59987 2 6 2C7.40013 2 8.1002 2 8.63498 2.27248C9.10538 2.51217 9.48783 2.89462 9.72752 3.36502C10 3.8998 10 4.59987 10 6Z"
								stroke="currentColor"
								stroke-width="1.5"
							></path>
						</svg>
					</a>

					<!-- Mobile controls group -->
					<div class="flex items-center gap-1 lg:hidden">
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
							<LightSwitch variant="ghost" />
							<LanguageSwitcher variant="ghost" />
						</div>
						{#if auth.isAuthenticated}
							<Button size="sm" href={localizedHref('/app')} class="w-full lg:w-auto">
								<T keyName="nav.dashboard" />
							</Button>
							<Button variant="outline" size="icon" class="size-8" onclick={() => auth.signOut()}>
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
