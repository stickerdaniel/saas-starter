<script lang="ts">
	import * as Sidebar from '$lib/components/ui/sidebar/index.js';
	import AuthenticatedSidebar from './authenticated-sidebar.svelte';
	import AuthenticatedHeader from './authenticated-header.svelte';
	import { ScrollArea } from '$lib/components/ui/scroll-area';
	import type { Snippet } from 'svelte';
	import type { SidebarConfig, User } from './types';

	interface Props {
		children?: Snippet;
		sidebarConfig: SidebarConfig;
		user?: User;
		routePrefix: string;
		rootLabel: string;
	}

	let { children, sidebarConfig, user, routePrefix, rootLabel }: Props = $props();

	// DEBUG: Log when user prop changes
	$effect(() => {
		console.log('[AuthenticatedLayout] user changed:', user);
		console.log('[AuthenticatedLayout] rendering:', !!user);
	});
</script>

{#if user}
	<Sidebar.Provider
		style="--sidebar-width: calc(var(--spacing) * 72); --header-height: calc(var(--spacing) * 12);"
		class="h-svh overflow-hidden"
	>
		<AuthenticatedSidebar variant="inset" config={sidebarConfig} {user} />
		<Sidebar.Inset>
			<AuthenticatedHeader {routePrefix} {rootLabel} />
			<ScrollArea class="overflow-hidden">
				<div class="flex flex-1 flex-col">
					<div class="@container/main flex flex-1 flex-col gap-2">
						<div class="flex flex-col gap-4 py-4 md:gap-6 md:py-6">
							{@render children?.()}
						</div>
					</div>
				</div>
			</ScrollArea>
		</Sidebar.Inset>
	</Sidebar.Provider>
{/if}
