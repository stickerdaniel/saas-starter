<script lang="ts">
	import MessageCircleIcon from '@tabler/icons-svelte/icons/message-circle';
	import BookIcon from '@tabler/icons-svelte/icons/book';
	import HomeIcon from '@tabler/icons-svelte/icons/home';
	import InnerShadowTopIcon from '@tabler/icons-svelte/icons/inner-shadow-top';
	import NavUser from '../nav-user.svelte';
	import * as Sidebar from '$lib/components/ui/sidebar/index.js';
	import type { ComponentProps } from 'svelte';
	import { localizedHref } from '$lib/utils/i18n';
	import { T } from '@tolgee/svelte';

	interface Props extends ComponentProps<typeof Sidebar.Root> {
		user?: {
			name: string;
			email: string;
			image?: string;
		};
	}

	let { user, ...restProps }: Props = $props();

	import { page } from '$app/state';
	import ChartBarIcon from '@tabler/icons-svelte/icons/chart-bar';

	const navItems = $derived([
		{
			translationKey: 'app.sidebar.dashboard',
			url: localizedHref('/app/dashboard'),
			icon: ChartBarIcon,
			isActive: page.url.pathname === `/${page.params.lang}/app/dashboard`
		},
		{
			translationKey: 'app.sidebar.community_chat',
			url: localizedHref('/app/community-chat'),
			icon: MessageCircleIcon,
			isActive: page.url.pathname === `/${page.params.lang}/app/community-chat`
		},
		{
			translationKey: 'app.sidebar.docs',
			url: localizedHref('https://docs.convex.dev'),
			icon: BookIcon,
			isActive: false
		},
		{
			translationKey: 'app.sidebar.home',
			url: localizedHref('/'),
			icon: HomeIcon,
			isActive: false
		}
	]);
</script>

<Sidebar.Root collapsible="offcanvas" {...restProps}>
	<Sidebar.Header>
		<Sidebar.Menu>
			<Sidebar.MenuItem>
				<Sidebar.MenuButton class="data-[slot=sidebar-menu-button]:!p-1.5">
					{#snippet child({ props })}
						<a href={localizedHref('/')} {...props}>
							<InnerShadowTopIcon class="!size-5" />
							<span class="text-base font-semibold"><T keyName="app.name" /></span>
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
	{#if user}
		<Sidebar.Footer>
			<NavUser user={{ name: user.name, email: user.email, avatar: user.image || '' }} />
		</Sidebar.Footer>
	{/if}
</Sidebar.Root>
