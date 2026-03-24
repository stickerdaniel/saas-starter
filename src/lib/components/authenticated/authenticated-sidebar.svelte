<script lang="ts">
	import NavUser from '../nav-user.svelte';
	import * as Sidebar from '$lib/components/ui/sidebar/index.js';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import { Button } from '$lib/components/ui/button/index.js';
	import { resolve } from '$app/paths';
	import type { ComponentProps } from 'svelte';
	import { T } from '@tolgee/svelte';
	import type { SidebarConfig, User } from './types';
	import { haptic } from '$lib/hooks/use-haptic.svelte';

	interface Props extends ComponentProps<typeof Sidebar.Root> {
		config: SidebarConfig;
		user?: User;
	}

	let { config, user, ...restProps }: Props = $props();
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
						<Sidebar.MenuItem>
							<Button
								variant="ghost"
								href={resolve(item.url)}
								onclick={() => haptic.trigger('light')}
								class="peer/menu-button w-full justify-start gap-2 {item.isActive
									? 'bg-muted text-foreground font-medium'
									: ''}"
								data-active={item.isActive || undefined}
								data-size="default"
							>
								{#if item.icon}
									<item.icon />
								{/if}
								<span><T keyName={item.translationKey} /></span>
							</Button>
							{#if item.badge && item.badge > 0}
								<Sidebar.MenuBadge>{item.badge >= 100 ? '99+' : item.badge}</Sidebar.MenuBadge>
							{/if}
						</Sidebar.MenuItem>
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
