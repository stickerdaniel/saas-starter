<script lang="ts">
	import NavUser from '../nav-user.svelte';
	import * as Sidebar from '$lib/components/ui/sidebar/index.js';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import { resolve } from '$app/paths';
	import type { ComponentProps } from 'svelte';
	import { T } from '@tolgee/svelte';
	import type { NavGroup, SidebarConfig, User } from './types';

	interface Props extends ComponentProps<typeof Sidebar.Root> {
		config: SidebarConfig;
		user?: User;
	}

	let { config, user, ...restProps }: Props = $props();

	function toTestId(url: string) {
		const normalized = url.replace(/^https?:\/\/[^/]+/, '');
		const segments = normalized
			.split('/')
			.filter(Boolean)
			.map((segment) => segment.replaceAll(':', '').replaceAll('.', ''));
		if (segments.length > 0 && /^[a-z]{2}(?:-[A-Z]{2})?$/.test(segments[0])) {
			segments.shift();
		}
		return segments.join('-');
	}

	const navGroups = $derived.by((): NavGroup[] => {
		if (config.navGroups && config.navGroups.length > 0) return config.navGroups;
		return [{ navItems: config.navItems ?? [] }];
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
								<Sidebar.MenuButton
									class="data-[slot=sidebar-menu-button]:!p-1.5 data-[state=open]:bg-sidebar-accent"
									{...props}
								>
									<config.header.icon class="!size-5" />
									<span class="text-base font-semibold">
										<T keyName={config.header.titleKey} />
									</span>
								</Sidebar.MenuButton>
							{/snippet}
						</DropdownMenu.Trigger>
						<DropdownMenu.Content align="start" class="w-56">
							{#each config.header.dropdownItems as item (item.translationKey)}
								<a href={resolve(item.url)}>
									<DropdownMenu.Item>
										<item.icon class="size-4" />
										<span><T keyName={item.translationKey} /></span>
									</DropdownMenu.Item>
								</a>
							{/each}
						</DropdownMenu.Content>
					</DropdownMenu.Root>
				{:else}
					<Sidebar.MenuButton class="data-[slot=sidebar-menu-button]:!p-1.5">
						{#snippet child({ props })}
							<a href={resolve(config.header.href)} {...props}>
								<config.header.icon class="!size-5" />
								<span class="text-base font-semibold">
									<T keyName={config.header.titleKey} />
								</span>
							</a>
						{/snippet}
					</Sidebar.MenuButton>
				{/if}
			</Sidebar.MenuItem>
		</Sidebar.Menu>
	</Sidebar.Header>

	<Sidebar.Content>
		{#each navGroups as group, index (group.labelKey ?? `group-${index}`)}
			<Sidebar.Group>
				{#if group.labelKey}
					<Sidebar.GroupLabel><T keyName={group.labelKey} /></Sidebar.GroupLabel>
				{/if}
				<Sidebar.GroupContent class="flex flex-col gap-2">
					<Sidebar.Menu>
						{#each group.navItems as item (item.translationKey)}
							<Sidebar.MenuItem>
								<Sidebar.MenuButton
									class={item.isActive ? 'bg-sidebar-accent text-sidebar-accent-foreground' : ''}
									data-testid={`sidebar-nav-${toTestId(item.url)}`}
								>
									{#snippet child({ props })}
										<a href={resolve(item.url)} {...props}>
											{#if item.icon}
												<item.icon />
											{/if}
											<span><T keyName={item.translationKey} /></span>
										</a>
									{/snippet}
								</Sidebar.MenuButton>
								{#if item.badge && item.badge > 0}
									<Sidebar.MenuBadge>{item.badge}</Sidebar.MenuBadge>
								{/if}
							</Sidebar.MenuItem>
						{/each}
					</Sidebar.Menu>
				</Sidebar.GroupContent>
			</Sidebar.Group>
		{/each}
	</Sidebar.Content>

	<Sidebar.Footer>
		{#if config.footerLinks && config.footerLinks.length > 0}
			<Sidebar.Menu>
				{#each config.footerLinks as link (link.translationKey)}
					{#if link.condition !== false}
						<Sidebar.MenuItem>
							<Sidebar.MenuButton>
								{#snippet child({ props })}
									<a href={resolve(link.url)} {...props}>
										<link.icon />
										<span><T keyName={link.translationKey} /></span>
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
