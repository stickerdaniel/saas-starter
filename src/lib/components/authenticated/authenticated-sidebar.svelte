<script lang="ts">
	import NavUser from '../nav-user.svelte';
	import * as Sidebar from '$lib/components/ui/sidebar/index.js';
	import * as Collapsible from '$lib/components/ui/collapsible/index.js';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import { Button } from '$lib/components/ui/button/index.js';
	import { resolve } from '$app/paths';
	import type { ComponentProps } from 'svelte';
	import { T } from '@tolgee/svelte';
	import type { SidebarConfig, User } from './types';
	import { haptic } from '$lib/hooks/use-haptic.svelte';
	import { PersistedState } from 'runed';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import SidebarThreadList from './sidebar-thread-list.svelte';
	import * as Kbd from '$lib/components/ui/kbd/index.js';

	interface Props extends ComponentProps<typeof Sidebar.Root> {
		config: SidebarConfig;
		user?: User;
		/** Thread sub-items passed separately to avoid snippet re-render destroying DOM nodes */
		threadSubItems?: import('./types').NavSubItem[];
	}

	let { config, user, threadSubItems, ...restProps }: Props = $props();

	const aiChatOpen = new PersistedState('ai-chat-threads-open', true);
</script>

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
										<T keyName={config.header.titleKey} />
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
							<T keyName={config.header.titleKey} />
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
											class="!transition-transform"
											onclick={() => haptic.trigger('light')}
										>
											{#snippet child({ props })}
												<a
													href={resolve(item.url)}
													{...props}
													onclick={item.disableNav ? (e) => e.preventDefault() : undefined}
												>
													{#if item.icon}
														<item.icon />
													{/if}
													<span><T keyName={item.translationKey} /></span>
													{#if item.kbd}
														<Kbd.Group class="ml-auto opacity-0 group-hover/menu-button:opacity-50">
															{#each item.kbd as key (key)}
																<Kbd.Root>{key}</Kbd.Root>
															{/each}
														</Kbd.Group>
													{/if}
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
							<!-- Standard nav item -->
							<Sidebar.MenuItem>
								<Sidebar.MenuButton
									isActive={item.isActive}
									class="!transition-transform"
									onclick={() => haptic.trigger('light')}
								>
									{#snippet child({ props })}
										<a href={resolve(item.url)} {...props}>
											{#if item.icon}
												<item.icon />
											{/if}
											<span><T keyName={item.translationKey} /></span>
											{#if item.kbd}
												<Kbd.Group class="ml-auto opacity-0 group-hover/menu-button:opacity-50">
													{#each item.kbd as key (key)}
														<Kbd.Root>{key}</Kbd.Root>
													{/each}
												</Kbd.Group>
											{/if}
										</a>
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
								class="!transition-transform"
								onclick={() => haptic.trigger('light')}
							>
								{#snippet child({ props })}
									<a href={resolve(link.url)} {...props}>
										<link.icon />
										<span><T keyName={link.translationKey} /></span>
										{#if link.kbd}
											<Kbd.Group class="ml-auto opacity-0 group-hover/menu-button:opacity-50">
												{#each link.kbd as key (key)}
													<Kbd.Root>{key}</Kbd.Root>
												{/each}
											</Kbd.Group>
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
