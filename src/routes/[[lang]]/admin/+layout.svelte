<script lang="ts">
	import PostHogIdentify from '$lib/components/analytics/PostHogIdentify.svelte';
	import SupportTicketMigrationBootstrap from '$lib/components/customer-support/support-ticket-migration-bootstrap.svelte';
	import { AuthenticatedLayout, getAdminSidebarConfig } from '$lib/components/authenticated';
	import { page } from '$app/state';
	import type { LayoutData } from './$types';
	import type { Snippet } from 'svelte';
	import { setContext } from 'svelte';
	import { useQuery } from 'convex-svelte';
	import { api } from '$lib/convex/_generated/api';
	import { getResourceDefinitions } from '$lib/admin/registry';
	import { adminResourceRuntimeMap } from '$lib/admin/runtime';

	interface Props {
		children?: Snippet;
		data: LayoutData;
	}

	let { children, data }: Props = $props();

	// Cast viewer to include role field from BetterAuth admin plugin
	const viewer = $derived(data.viewer as typeof data.viewer & { role?: string });

	// Get count of threads awaiting admin response (for sidebar badge)
	const awaitingCount = useQuery(api.admin.support.queries.getAwaitingResponseCount, {});
	const resourceDefinitions = getResourceDefinitions();
	const resourceBadgeQueries = resourceDefinitions
		.filter((resource) => resource.badgeQuery)
		.map((resource) => ({
			resourceName: resource.name,
			query: useQuery(adminResourceRuntimeMap[resource.name].count, {
				search: undefined,
				trashed: resource.badgeQuery?.trashed,
				filters: resource.badgeQuery?.filters ?? {},
				lens: resource.badgeQuery?.lens
			} as never)
		}));
	const resourceBadges = $derived.by(() => {
		const entries = resourceBadgeQueries.map((entry) => [
			entry.resourceName,
			entry.query.data === undefined ? undefined : Number(entry.query.data)
		]);
		return Object.fromEntries(entries) as Record<string, number | undefined>;
	});

	// Generate sidebar config based on current page state
	const sidebarConfig = $derived(
		getAdminSidebarConfig({
			pathname: page.url.pathname,
			lang: page.params.lang,
			supportBadge: awaitingCount.data,
			resourceBadges,
			viewer
		})
	);

	// Full control mode for pages that manage their own scroll/padding (e.g., support with PaneForge)
	const fullControl = $derived(page.url.pathname.includes('/admin/support'));

	// Provide current user ID for child components (e.g., preventing self-modification in admin actions)
	// Context value is intentionally snapshot for layout lifetime.
	// svelte-ignore state_referenced_locally
	setContext('currentUserId', viewer?._id);
</script>

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
