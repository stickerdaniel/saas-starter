<script lang="ts">
	import { AuthenticatedLayout, getAdminSidebarConfig } from '$lib/components/authenticated';
	import { page } from '$app/state';
	import type { LayoutData } from './$types';
	import type { Snippet } from 'svelte';
	import { setContext } from 'svelte';
	import { useQuery } from 'convex-svelte';
	import { api } from '$lib/convex/_generated/api';

	interface Props {
		children?: Snippet;
		data: LayoutData;
	}

	let { children, data }: Props = $props();

	// Cast viewer to include role field from BetterAuth admin plugin
	const viewer = $derived(data.viewer as typeof data.viewer & { role?: string });

	// Get count of threads awaiting admin response (for sidebar badge)
	const awaitingCount = useQuery(api.admin.support.queries.getAwaitingResponseCount, {});

	// Generate sidebar config based on current page state
	const sidebarConfig = $derived(
		getAdminSidebarConfig({
			pathname: page.url.pathname,
			lang: page.params.lang,
			supportBadge: awaitingCount.data
		})
	);

	// Full control mode for pages that manage their own scroll/padding (e.g., support with PaneForge)
	const fullControl = $derived(page.url.pathname.includes('/admin/support'));

	// Provide current user ID for child components (e.g., preventing self-modification in admin actions)
	setContext('currentUserId', viewer?._id);
</script>

<AuthenticatedLayout
	{sidebarConfig}
	{fullControl}
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
