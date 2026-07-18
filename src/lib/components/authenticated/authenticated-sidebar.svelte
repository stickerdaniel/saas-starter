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
		/** Whether more threads exist beyond the currently loaded threadSubItems */
		threadsHasMore?: boolean;
		/** Requests a bigger thread page from the owning query */
		onLoadMoreThreads?: () => void;
	}

	let {
		config,
		user,
		threadSubItems,
		threadsHasMore = false,
		onLoadMoreThreads,
		...restProps
	}: Props = $props();

	const aiChatOpen = new PersistedState('ai-chat-threads-open', true);
</script>

{#snippet navItemBody(item: NavItem)}
	{#if item.icon}
		<item.icon />
	{/if}
	<span class="min-w-0 truncate"><T keyName={item.translationKey} /></span>
	{#if item.kbd || (item.badge ?? 0) > 0}
		{@render trailingOverlay(item.kbd, item.badge)}
	{/if}
{/snippet}

<!-- Right-edge overlay holding the optional count badge and the shortcut hint that is
	 revealed on hover. Absolutely placed so it never steals width from the label when
	 hidden. The badge sits at the strip's right end in normal flow, so a visible badge
	 pushes the shortcut hint left by exactly its own width, and both live inside the
	 menu button so they ride its pressed-state translation. The hover background lives
	 on a ::before layer (kept below the content by the stacking context the mask
	 creates) so it can fade in without hiding the badge: the opaque match for the
	 row's hover colour (sidebar-accent-hover), switching to sidebar-accent only once
	 the row is the active route. Pressing keeps the hover colour to match the row,
	 which stays on its hover background until release. A left mask fades that edge
	 into the label, pure alpha so it never muddies the colour. pr-8 makes room for the
	 menu-action chevron. -->
{#snippet trailingOverlay(keys: string[] | undefined, badge: number | undefined)}
	<span
		class="pointer-events-none absolute inset-y-0 -right-2 flex items-center justify-end gap-2 overflow-hidden rounded-r-md [mask-image:linear-gradient(to_right,transparent,#000_2rem)] pr-3 pl-8 group-has-data-[sidebar=menu-action]/menu-item:pr-8 before:absolute before:inset-0 before:-z-10 before:rounded-r-md before:bg-sidebar-accent-hover before:opacity-0 group-hover/menu-button:before:opacity-100 group-data-[active=true]/menu-button:before:bg-sidebar-accent"
	>
		{#if keys}
			<Kbd.Group class="opacity-0 group-hover/menu-button:opacity-100">
				{#each keys as key (key)}
					<Kbd.Root>{key}</Kbd.Root>
				{/each}
			</Kbd.Group>
		{/if}
		{#if (badge ?? 0) > 0}
			<span
				data-sidebar="menu-badge"
				class="flex h-5 min-w-5 items-center justify-center rounded-md px-1 text-xs font-medium tabular-nums select-none"
			>
				{(badge ?? 0) >= 100 ? '99+' : badge}
			</span>
		{/if}
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
													data-testid={item.testId}
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
													<span class="sr-only"><T keyName="aria.toggle_threads" /></span>
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
											<a href={resolve(item.url)} data-testid={item.testId} {...props}>
												{@render navItemBody(item)}
											</a>
										{:else}
											<button type="button" {...props}>
												{@render navItemBody(item)}
											</button>
										{/if}
									{/snippet}
								</Sidebar.MenuButton>
							</Sidebar.MenuItem>
						{/if}
					{/each}
				</Sidebar.Menu>
			</Sidebar.GroupContent>
			<!-- Thread list only renders the currently loaded page; hasMore/onLoadMoreThreads
				 come from the owning listThreads query so "Show more" reflects the real
				 backend count instead of a client-only slice. -->
			{#if aiChatOpen.current}
				<SidebarThreadList
					items={threadSubItems ?? []}
					hasMore={threadsHasMore}
					onShowMore={onLoadMoreThreads ?? (() => {})}
				/>
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
											{@render trailingOverlay(link.kbd, undefined)}
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
