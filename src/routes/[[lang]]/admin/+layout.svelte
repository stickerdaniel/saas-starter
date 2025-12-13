<script lang="ts">
	import { AuthenticatedLayout, getAdminSidebarConfig } from '$lib/components/authenticated';
	import { page } from '$app/state';
	import type { LayoutData } from './$types';
	import type { Snippet } from 'svelte';
	import { setContext } from 'svelte';

	interface Props {
		children?: Snippet;
		data: LayoutData;
	}

	let { children, data }: Props = $props();

	// Cast viewer to include role field from BetterAuth admin plugin
	const viewer = $derived(data.viewer as typeof data.viewer & { role?: string });

	// Generate sidebar config based on current page state
	const sidebarConfig = $derived(
		getAdminSidebarConfig({ pathname: page.url.pathname, lang: page.params.lang })
	);

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

<AuthenticatedLayout
	{sidebarConfig}
	user={viewer
		? {
				name: viewer.name ?? 'Admin',
				email: viewer.email ?? '',
				image: viewer.image ?? undefined,
				role: viewer.role ?? 'admin'
			}
		: undefined}
	routePrefix="admin"
	rootLabel="Admin"
>
	{@render children?.()}
</AuthenticatedLayout>
