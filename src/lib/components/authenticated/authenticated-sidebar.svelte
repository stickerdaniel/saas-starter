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
	import autoAnimate from '@formkit/auto-animate';
	import * as Kbd from '$lib/components/ui/kbd/index.js';
	import { getTranslate } from '@tolgee/svelte';

	const { t } = getTranslate();

	interface Props extends ComponentProps<typeof Sidebar.Root> {
		config: SidebarConfig;
		user?: User;
	}

	let { config, user, ...restProps }: Props = $props();

	function timeAgo(timestamp: number): string {
		const diff = Date.now() - timestamp;
		const minutes = Math.floor(diff / 60_000);
		if (minutes < 1) return 'now';
		if (minutes < 60) return `${minutes}m`;
		const hours = Math.floor(minutes / 60);
		if (hours < 24) return `${hours}h`;
		return `${Math.floor(hours / 24)}d`;
	}

	const aiChatOpen = new PersistedState('ai-chat-threads-open', true);

	let subMenuRef = $state<HTMLElement | null>(null);

	$effect(() => {
		if (!subMenuRef) return;
		const controller = autoAnimate(subMenuRef, { duration: 180, easing: 'ease-out' });
		return () => {
			controller.destroy?.();
		};
	});
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
									class="w-full justify-start gap-2 px-1.5 data-[state=open]:bg-muted"
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
						class="w-full justify-start gap-2 px-1.5"
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
									<Sidebar.MenuItem {...props} class="has-[:active]:translate-y-px">
										<Sidebar.MenuButton
											isActive={item.isActive}
											class="active:!translate-y-0"
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
														<Kbd.Root
															class="ml-auto opacity-0 transition-opacity group-hover/menu-item:opacity-50"
														>
															{item.kbd}
														</Kbd.Root>
													{/if}
												</a>
											{/snippet}
										</Sidebar.MenuButton>
										<Collapsible.Trigger>
											{#snippet child({ props })}
												<Sidebar.MenuAction
													{...props}
													class="transition-transform duration-200 data-[state=open]:rotate-90"
												>
													<ChevronRightIcon />
												</Sidebar.MenuAction>
											{/snippet}
										</Collapsible.Trigger>
										<Collapsible.Content>
											<Sidebar.MenuSub bind:ref={subMenuRef}>
												{#if item.subItems}
													{#each item.subItems as sub (sub.id)}
														<Sidebar.MenuSubItem>
															<Sidebar.MenuSubButton
																isActive={sub.isActive}
																onclick={() => haptic.trigger('light')}
															>
																{#snippet child({ props })}
																	<a
																		href={resolve(sub.url)}
																		{...props}
																		class="{props.class} flex items-center gap-1"
																	>
																		<span class="min-w-0 truncate">{sub.label}</span>
																		{#if sub.timestamp}
																			<span
																				class="ml-auto shrink-0 text-[11px] text-muted-foreground/50"
																			>
																				{timeAgo(sub.timestamp)}
																			</span>
																		{/if}
																	</a>
																{/snippet}
															</Sidebar.MenuSubButton>
														</Sidebar.MenuSubItem>
													{/each}
													{#if item.hasMore && item.onLoadMore}
														<Sidebar.MenuSubItem>
															<button
																class="w-full px-2 py-1 text-left text-xs text-muted-foreground hover:text-foreground active:translate-y-px"
																onclick={() => {
																	haptic.trigger('light');
																	item.onLoadMore?.();
																}}
															>
																{$t('app.sidebar.show_more')}
															</button>
														</Sidebar.MenuSubItem>
													{/if}
												{/if}
											</Sidebar.MenuSub>
										</Collapsible.Content>
									</Sidebar.MenuItem>
								{/snippet}
							</Collapsible.Root>
						{:else}
							<!-- Standard nav item -->
							<Sidebar.MenuItem>
								<Button
									variant="ghost"
									href={resolve(item.url)}
									onclick={() => haptic.trigger('light')}
									class="peer/menu-button w-full justify-start gap-2 {item.isActive
										? 'bg-muted font-medium text-foreground'
										: ''}"
									data-active={item.isActive || undefined}
									data-size="default"
								>
									{#if item.icon}
										<item.icon />
									{/if}
									<span><T keyName={item.translationKey} /></span>
									{#if item.kbd}
										<Kbd.Root
											class="ml-auto opacity-0 transition-opacity group-hover/menu-item:opacity-50"
										>
											{item.kbd}
										</Kbd.Root>
									{/if}
								</Button>
								{#if item.badge && item.badge > 0}
									<Sidebar.MenuBadge>{item.badge >= 100 ? '99+' : item.badge}</Sidebar.MenuBadge>
								{/if}
							</Sidebar.MenuItem>
						{/if}
					{/each}
				</Sidebar.Menu>
			</Sidebar.GroupContent>
		</Sidebar.Group>
	</Sidebar.Content>

	<Sidebar.Footer>
		{#if config.footerLinks && config.footerLinks.length > 0}
			<Sidebar.Menu>
				{#each config.footerLinks as link (link.translationKey)}
					{#if link.condition !== false}
						<Sidebar.MenuItem>
							<Button
								variant="ghost"
								href={resolve(link.url)}
								onclick={() => haptic.trigger('light')}
								class="w-full justify-start gap-2"
							>
								<link.icon />
								<span><T keyName={link.translationKey} /></span>
								{#if link.kbd}
									<Kbd.Root
										class="ml-auto opacity-0 transition-opacity group-hover/menu-item:opacity-50"
									>
										{link.kbd}
									</Kbd.Root>
								{/if}
							</Button>
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
