<script lang="ts">
	import { browser } from '$app/environment';
	import * as Sidebar from '$lib/components/ui/sidebar/index.js';
	import AuthenticatedSidebar from './authenticated-sidebar.svelte';
	import AuthenticatedHeader from './authenticated-header.svelte';
	import { ScrollArea } from '$lib/components/ui/scroll-area';
	import type { Snippet } from 'svelte';
	import type { NavSubItem, SidebarConfig, User } from './types';
	import { onMount } from 'svelte';

	interface Props {
		children?: Snippet;
		sidebarConfig: SidebarConfig;
		user?: User;
		routePrefix: string;
		rootLabel: string;
		fullControl?: boolean;
		/** Thread sub-items passed separately to preserve DOM nodes in autoAnimate */
		threadSubItems?: NavSubItem[];
	}

	let {
		children,
		sidebarConfig,
		user,
		routePrefix,
		rootLabel,
		fullControl = false,
		threadSubItems
	}: Props = $props();

	$effect(() => {
		if (!browser || !user) return;

		document.documentElement.classList.add('auth-shell-bg');
		document.body.classList.add('auth-shell-bg');

		return () => {
			document.documentElement.classList.remove('auth-shell-bg');
			document.body.classList.remove('auth-shell-bg');
		};
	});

	// Signal that Svelte hydration is complete (used by E2E tests via waitForAuthenticated)
	onMount(() => {
		document.documentElement.dataset.hydrated = '';
	});
</script>

{#if user}
	<Sidebar.Provider
		style="--sidebar-width: calc(var(--spacing) * 72); --header-height: calc(var(--spacing) * 12);"
		class="h-svh overflow-hidden"
	>
		<AuthenticatedSidebar variant="inset" config={sidebarConfig} {user} {threadSubItems} />
		<Sidebar.Inset class={fullControl ? 'flex flex-col overflow-hidden' : ''}>
			<AuthenticatedHeader {routePrefix} {rootLabel} />

			{#if fullControl}
				<!-- Full control: page manages scroll, no padding -->
				<div class="@container/main min-h-0 flex-1">
					{@render children?.()}
				</div>
			{:else}
				<!-- Default: layout manages scroll with padding -->
				<ScrollArea class="overflow-hidden">
					<div class="flex flex-1 flex-col">
						<div class="@container/main flex flex-1 flex-col gap-2">
							<div class="flex flex-col gap-4 py-4 md:gap-6 md:py-6">
								{@render children?.()}
							</div>
						</div>
					</div>
				</ScrollArea>
			{/if}
		</Sidebar.Inset>
	</Sidebar.Provider>
{/if}
