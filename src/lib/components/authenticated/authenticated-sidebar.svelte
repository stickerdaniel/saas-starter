<script lang="ts">
	import NavUser from '../nav-user.svelte';
	import * as Sidebar from '$lib/components/ui/sidebar/index.js';
	import type { ComponentProps } from 'svelte';
	import { T } from '@tolgee/svelte';
	import type { SidebarConfig, User } from './types';

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
				<Sidebar.MenuButton class="data-[slot=sidebar-menu-button]:!p-1.5">
					{#snippet child({ props })}
						<a href={config.header.href} {...props}>
							<config.header.icon class="!size-5" />
							<span class="text-base font-semibold">
								<T keyName={config.header.titleKey} />
							</span>
						</a>
					{/snippet}
				</Sidebar.MenuButton>
			</Sidebar.MenuItem>
		</Sidebar.Menu>
	</Sidebar.Header>

	<Sidebar.Content>
		<Sidebar.Group>
			<Sidebar.GroupContent class="flex flex-col gap-2">
				<Sidebar.Menu>
					{#each config.navItems as item}
						<Sidebar.MenuItem>
							<Sidebar.MenuButton
								class={item.isActive ? 'bg-sidebar-accent text-sidebar-accent-foreground' : ''}
							>
								{#snippet child({ props })}
									<a href={item.url} {...props}>
										{#if item.icon}
											<item.icon />
										{/if}
										<span><T keyName={item.translationKey} /></span>
									</a>
								{/snippet}
							</Sidebar.MenuButton>
						</Sidebar.MenuItem>
					{/each}
				</Sidebar.Menu>
			</Sidebar.GroupContent>
		</Sidebar.Group>
	</Sidebar.Content>

	<Sidebar.Footer>
		{#if config.footerLinks && config.footerLinks.length > 0}
			<Sidebar.Menu>
				{#each config.footerLinks as link}
					{#if link.condition !== false}
						<Sidebar.MenuItem>
							<Sidebar.MenuButton>
								{#snippet child({ props })}
									<a href={link.url} {...props}>
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
