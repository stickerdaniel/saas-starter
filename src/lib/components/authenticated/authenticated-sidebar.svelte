<script lang="ts">
	import NavUser from '../nav-user.svelte';
	import * as Sidebar from '$lib/components/ui/sidebar/index.js';
	import * as Collapsible from '$lib/components/ui/collapsible/index.js';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import { Button } from '$lib/components/ui/button/index.js';
	import { resolve } from '$app/paths';
	import type { ComponentProps } from 'svelte';
	import { T } from '@tolgee/svelte';
	import type { NavItem, NavSubItem, SidebarConfig, User } from './types';
	import { haptic } from '$lib/hooks/use-haptic.svelte';
	import { PersistedState } from 'runed';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import SidebarThreadList from './sidebar-thread-list.svelte';
	import * as Kbd from '$lib/components/ui/kbd/index.js';

	interface Props extends ComponentProps<typeof Sidebar.Root> {
		config: SidebarConfig;
		user?: User;
		/** Thread sub-items passed separately to avoid snippet re-render destroying DOM nodes */
		threadSubItems?: NavSubItem[];
	}

	let { config, user, threadSubItems, ...restProps }: Props = $props();

	const aiChatOpen = new PersistedState('ai-chat-threads-open', true);
</script>

{#snippet navItemBody(item: NavItem)}
	{#if item.icon}
		<item.icon />
	{/if}
	<span class="min-w-0 truncate"><T keyName={item.translationKey} /></span>
	{#if item.kbd}
		{@render shortcutHint(item.kbd)}
	{/if}
{/snippet}

<!-- Shortcut hint, revealed on hover. Absolutely placed so it never steals width
	 from the label when hidden. The background is the opaque match for the row's
	 hover colour (sidebar-accent-hover), switching to sidebar-accent only once the
	 row is the active route. Pressing keeps the hover colour to match the row, which
	 stays on its hover background until release. A left mask fades that edge into the
	 label, pure alpha so it never muddies the colour. pr-8 makes room for the
	 menu-action chevron. -->
{#snippet shortcutHint(keys: string[])}
	<span
		class="pointer-events-none absolute inset-y-0 -right-2 flex items-center justify-end overflow-hidden rounded-r-md bg-sidebar-accent-hover [mask-image:linear-gradient(to_right,transparent,#000_2rem)] pr-3 pl-8 opacity-0 group-hover/menu-button:opacity-100 group-has-data-[sidebar=menu-action]/menu-item:pr-8 group-data-[active=true]/menu-button:bg-sidebar-accent"
	>
		<Kbd.Group>
			{#each keys as key (key)}
				<Kbd.Root>{key}</Kbd.Root>
			{/each}
		</Kbd.Group>
	</span>
{/snippet}

<Sidebar.Root collapsible="offcanvas" {...restProps}>
	<Sidebar.Header>
		<Sidebar.Menu>
			<Sidebar.MenuItem>
				{#if config.header.dropdownItems && config.header.dropdownItems.length > 0}
					<DropdownMenu.Root>
						<DropdownMenu.Trigger>
							{#snippet child({ props })}
								<Button
									variant="ghost"
									class="w-full justify-start gap-2 px-1.5 !transition-transform data-[state=open]:bg-muted"
									{...props}
								>
									<config.header.icon class="!size-5" />
									<span class="text-base font-semibold">
										{#if config.header.title !== undefined}
											{config.header.title}
										{:else}
											<T keyName={config.header.titleKey} />
										{/if}
									</span>
								</Button>
							{/snippet}
						</DropdownMenu.Trigger>
						<DropdownMenu.Content align="start" class="w-56">
							{#each config.header.dropdownItems as item (item.translationKey)}
								<a href={resolve(item.url)} onclick={() => haptic.trigger('light')}>
									<DropdownMenu.Item>
										<item.icon class="size-4" />
										<span><T keyName={item.translationKey} /></span>
									</DropdownMenu.Item>
								</a>
							{/each}
						</DropdownMenu.Content>
					</DropdownMenu.Root>
				{:else}
					<Button
						variant="ghost"
						href={resolve(config.header.href)}
						class="w-full justify-start gap-2 px-1.5 !transition-transform"
					>
						<config.header.icon class="!size-5" />
						<span class="text-base font-semibold">
							{#if config.header.title !== undefined}
								{config.header.title}
							{:else}
								<T keyName={config.header.titleKey} />
							{/if}
						</span>
					</Button>
				{/if}
			</Sidebar.MenuItem>
		</Sidebar.Menu>
	</Sidebar.Header>

	<Sidebar.Content>
		<Sidebar.Group>
			<Sidebar.GroupContent class="flex flex-col gap-2">
				<Sidebar.Menu>
					{#each config.navItems as item (item.translationKey)}
						{#if item.collapsible}
							<!-- Collapsible nav item: main button navigates, chevron toggles -->
							<Collapsible.Root
								open={aiChatOpen.current}
								onOpenChange={(open) => (aiChatOpen.current = open)}
								class="group/collapsible"
							>
								{#snippet child({ props })}
									<Sidebar.MenuItem {...props}>
										<Sidebar.MenuButton
											isActive={item.isActive}
											class="relative !transition-transform"
											onclick={() => haptic.trigger('light')}
										>
											{#snippet child({ props })}
												<a
													href={item.url ? resolve(item.url) : undefined}
													{...props}
													onclick={item.disableNav ? (e) => e.preventDefault() : undefined}
												>
													{@render navItemBody(item)}
												</a>
											{/snippet}
										</Sidebar.MenuButton>
										<Collapsible.Trigger>
											{#snippet child({ props })}
												<Sidebar.MenuAction
													{...props}
													class="transition-transform duration-200 active:translate-y-px data-[state=open]:rotate-90"
												>
													<ChevronRightIcon />
												</Sidebar.MenuAction>
											{/snippet}
										</Collapsible.Trigger>
									</Sidebar.MenuItem>
								{/snippet}
							</Collapsible.Root>
						{:else}
							<!-- Standard nav item: anchor when it has a url, button when it triggers an action -->
							<Sidebar.MenuItem>
								<Sidebar.MenuButton
									isActive={item.isActive}
									class="relative !transition-transform"
									onclick={() => {
										haptic.trigger('light');
										item.onSelect?.();
									}}
								>
									{#snippet child({ props })}
										{#if item.url}
											<a href={resolve(item.url)} {...props}>
												{@render navItemBody(item)}
											</a>
										{:else}
											<button type="button" {...props}>
												{@render navItemBody(item)}
											</button>
										{/if}
									{/snippet}
								</Sidebar.MenuButton>
								{#if item.badge && item.badge > 0}
									<Sidebar.MenuBadge>{item.badge >= 100 ? '99+' : item.badge}</Sidebar.MenuBadge>
								{/if}
							</Sidebar.MenuItem>
						{/if}
					{/each}
				</Sidebar.Menu>
			</Sidebar.GroupContent>
			<!-- Thread list with client-side display limit (t3code pattern).
				 "Show more" only changes local state inside SidebarThreadList,
				 so no parent re-render and autoAnimate works correctly. -->
			{#if aiChatOpen.current}
				<SidebarThreadList items={threadSubItems ?? []} />
			{/if}
		</Sidebar.Group>
	</Sidebar.Content>

	<Sidebar.Footer>
		{#if config.footerLinks && config.footerLinks.length > 0}
			<Sidebar.Menu>
				{#each config.footerLinks as link (link.translationKey)}
					{#if link.condition !== false}
						<Sidebar.MenuItem>
							<Sidebar.MenuButton
								class="relative !transition-transform"
								onclick={() => haptic.trigger('light')}
							>
								{#snippet child({ props })}
									<a href={resolve(link.url)} {...props}>
										<link.icon />
										<span class="min-w-0 truncate"><T keyName={link.translationKey} /></span>
										{#if link.kbd}
											{@render shortcutHint(link.kbd)}
										{/if}
									</a>
								{/snippet}
							</Sidebar.MenuButton>
						</Sidebar.MenuItem>
					{/if}
				{/each}
			</Sidebar.Menu>
		{/if}
		{#if user}
			<NavUser user={{ name: user.name, email: user.email, avatar: user.image || '' }} />
		{/if}
	</Sidebar.Footer>
</Sidebar.Root>
