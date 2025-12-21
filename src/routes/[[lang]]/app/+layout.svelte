<script lang="ts">
	import { AuthenticatedLayout, getAppSidebarConfig } from '$lib/components/authenticated';
	import { page } from '$app/state';
	import type { LayoutData } from './$types';
	import type { Snippet } from 'svelte';

	interface Props {
		children?: Snippet;
		data: LayoutData;
	}

	let { children, data }: Props = $props();

	// Cast viewer to include role field from BetterAuth admin plugin
	const viewer = $derived(data.viewer as typeof data.viewer & { role?: string });

	// Generate sidebar config based on current page state
	const sidebarConfig = $derived(
		getAppSidebarConfig({ pathname: page.url.pathname, lang: page.params.lang }, viewer?.role)
	);

	// DEBUG: Log when viewer changes
	$effect(() => {
		console.log('[App Layout] viewer changed:', viewer);
		console.log('[App Layout] data.viewer:', data.viewer);
	});
</script>

<AuthenticatedLayout
	{sidebarConfig}
	user={viewer
		? {
				name: viewer.name ?? 'User',
				email: viewer.email ?? '',
				image: viewer.image ?? undefined,
				role: viewer.role ?? 'user'
			}
		: undefined}
	routePrefix="app"
	rootLabel="App"
>
	{@render children?.()}
</AuthenticatedLayout>
