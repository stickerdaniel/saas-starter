<script lang="ts">
	import * as Sidebar from '$lib/components/ui/sidebar/index.js';
	import AppSidebar from '$lib/components/app/app-sidebar.svelte';
	import AppHeader from '$lib/components/app/app-header.svelte';
	import type { LayoutData } from './$types';
	import type { Snippet } from 'svelte';
	import { ScrollArea } from '$lib/components/ui/scroll-area';

	interface Props {
		children?: Snippet;
		data: LayoutData;
	}

	let { children, data }: Props = $props();
</script>

{#if data.viewer}
	<Sidebar.Provider
		style="--sidebar-width: calc(var(--spacing) * 72); --header-height: calc(var(--spacing) * 12);"
		class="h-svh overflow-hidden"
	>
		<AppSidebar
			variant="inset"
			user={{
				name: data.viewer.name ?? 'User',
				email: data.viewer.email ?? '',
				image: data.viewer.image ?? undefined
			}}
		/>
		<Sidebar.Inset>
			<AppHeader />
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
