<script lang="ts">
	import PostHogIdentify from '$lib/components/analytics/PostHogIdentify.svelte';
	import SupportTicketMigrationBootstrap from '$lib/components/customer-support/support-ticket-migration-bootstrap.svelte';
	import { AuthenticatedLayout, getAdminSidebarConfig } from '$lib/components/authenticated';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { localizedHref } from '$lib/utils/i18n';
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
	// Context value is intentionally snapshot for layout lifetime.
	// svelte-ignore state_referenced_locally
	setContext('currentUserId', viewer?._id);

	// Keyboard shortcuts for admin sidebar navigation
	function handleKeydown(e: KeyboardEvent) {
		if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey) return;
		const target = e.target as HTMLElement;
		if (target.closest('input, textarea, [contenteditable]')) return;

		const routes: Record<string, string> = {
			'1': localizedHref('/admin/dashboard'),
			'2': localizedHref('/admin/users'),
			'3': localizedHref('/admin/support'),
			'4': localizedHref('/admin/settings'),
			';': localizedHref('/app')
		};

		const url = routes[e.key];
		if (!url) return;

		e.preventDefault();
		goto(resolve(url));
	}
</script>

<svelte:document onkeydown={handleKeydown} />

<PostHogIdentify />
<SupportTicketMigrationBootstrap />

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
