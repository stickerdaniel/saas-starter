<script lang="ts">
	import MessageCircleIcon from '@tabler/icons-svelte/icons/message-circle';
	import BookIcon from '@tabler/icons-svelte/icons/book';
	import HomeIcon from '@tabler/icons-svelte/icons/home';
	import InnerShadowTopIcon from '@tabler/icons-svelte/icons/inner-shadow-top';
	import NavUser from './nav-user.svelte';
	import * as Sidebar from '$lib/components/ui/sidebar/index.js';
	import type { ComponentProps } from 'svelte';

	interface Props extends ComponentProps<typeof Sidebar.Root> {
		user?: {
			name: string;
			email: string;
			image?: string;
		};
	}

	let { user, ...restProps }: Props = $props();

	const navItems = [
		{
			title: 'Chat',
			url: '/product',
			icon: MessageCircleIcon,
			isActive: true
		},
		{
			title: 'Docs',
			url: 'https://docs.convex.dev',
			icon: BookIcon
		},
		{
			title: 'Home',
			url: '/',
			icon: HomeIcon
		}
	];
</script>

<Sidebar.Root collapsible="offcanvas" {...restProps}>
	<Sidebar.Header>
		<Sidebar.Menu>
			<Sidebar.MenuItem>
				<Sidebar.MenuButton class="data-[slot=sidebar-menu-button]:!p-1.5">
					{#snippet child({ props })}
						<a href="/" {...props}>
							<InnerShadowTopIcon class="!size-5" />
							<span class="text-base font-semibold">SaaS Starter</span>
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
								tooltipContent={item.title}
								class={item.isActive ? 'bg-sidebar-accent text-sidebar-accent-foreground' : ''}
							>
								{#snippet child({ props })}
									<a href={item.url} {...props}>
										{#if item.icon}
											<item.icon />
										{/if}
										<span>{item.title}</span>
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
			<NavUser {user} />
		</Sidebar.Footer>
	{/if}
</Sidebar.Root>
