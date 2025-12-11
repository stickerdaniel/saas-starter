<script lang="ts">
	import UsersIcon from '@tabler/icons-svelte/icons/users';
	import LayoutDashboardIcon from '@tabler/icons-svelte/icons/layout-dashboard';
	import ArrowLeftIcon from '@tabler/icons-svelte/icons/arrow-left';
	import ServerCogIcon from '@tabler/icons-svelte/icons/server-cog';
	import NavUser from '../nav-user.svelte';
	import * as Sidebar from '$lib/components/ui/sidebar/index.js';
	import type { ComponentProps } from 'svelte';
	import { localizedHref } from '$lib/utils/i18n';
	import { T } from '@tolgee/svelte';
	import { page } from '$app/state';

	interface Props extends ComponentProps<typeof Sidebar.Root> {
		user?: {
			name: string;
			email: string;
			image?: string;
			role?: string;
		};
	}

	let { user, ...restProps }: Props = $props();

	const navItems = $derived([
		{
			translationKey: 'admin.sidebar.dashboard',
			url: localizedHref('/admin/dashboard'),
			icon: LayoutDashboardIcon,
			isActive: page.url.pathname.startsWith(`/${page.params.lang}/admin/dashboard`)
		},
		{
			translationKey: 'admin.sidebar.users',
			url: localizedHref('/admin/users'),
			icon: UsersIcon,
			isActive: page.url.pathname.startsWith(`/${page.params.lang}/admin/users`)
		}
	]);
</script>

<Sidebar.Root collapsible="offcanvas" {...restProps}>
	<Sidebar.Header>
		<Sidebar.Menu>
			<Sidebar.MenuItem>
				<Sidebar.MenuButton class="data-[slot=sidebar-menu-button]:!p-1.5">
					{#snippet child({ props })}
						<a href={localizedHref('/admin')} {...props}>
							<ServerCogIcon class="!size-5" />
							<span class="text-base font-semibold"><T keyName="admin.title" /></span>
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
					{#each navItems as item}
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
		<Sidebar.Menu>
			<Sidebar.MenuItem>
				<Sidebar.MenuButton>
					{#snippet child({ props })}
						<a href={localizedHref('/app')} {...props}>
							<ArrowLeftIcon />
							<span><T keyName="admin.sidebar.back_to_app" /></span>
						</a>
					{/snippet}
				</Sidebar.MenuButton>
			</Sidebar.MenuItem>
		</Sidebar.Menu>
		{#if user}
			<NavUser user={{ name: user.name, email: user.email, avatar: user.image || '' }} />
		{/if}
	</Sidebar.Footer>
</Sidebar.Root>
