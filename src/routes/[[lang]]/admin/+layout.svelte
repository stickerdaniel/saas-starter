<script lang="ts">
	import * as Sidebar from '$lib/components/ui/sidebar/index.js';
	import AdminSidebar from '$lib/components/admin/admin-sidebar.svelte';
	import AdminHeader from '$lib/components/admin/admin-header.svelte';
	import type { LayoutData } from './$types';
	import type { Snippet } from 'svelte';
	import { setContext } from 'svelte';
	import { ScrollArea } from '$lib/components/ui/scroll-area';

	interface Props {
		children?: Snippet;
		data: LayoutData;
	}

	let { children, data }: Props = $props();

	// Cast viewer to include role field from BetterAuth admin plugin
	const viewer = $derived(data.viewer as typeof data.viewer & { role?: string });

	// Create reactive state for known user count (shared across admin pages)
	let knownUserCount = $state<number | null>(null);

	// Provide context with getter and setter for user count
	setContext('adminUserCount', {
		get: () => knownUserCount,
		set: (count: number) => {
			knownUserCount = count;
		}
	});
</script>

{#if viewer}
	<Sidebar.Provider
		style="--sidebar-width: calc(var(--spacing) * 72); --header-height: calc(var(--spacing) * 12);"
		class="h-svh overflow-hidden"
	>
		<AdminSidebar
			variant="inset"
			user={{
				name: viewer.name ?? 'Admin',
				email: viewer.email ?? '',
				image: viewer.image ?? undefined,
				role: viewer.role ?? 'admin'
			}}
		/>
		<Sidebar.Inset>
			<AdminHeader />
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
