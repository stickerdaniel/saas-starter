<script lang="ts">
	import PostHogIdentify from '$lib/components/analytics/PostHogIdentify.svelte';
	import SupportTicketMigrationBootstrap from '$lib/components/customer-support/support-ticket-migration-bootstrap.svelte';
	import { AuthenticatedLayout, getAppSidebarConfig } from '$lib/components/authenticated';
	import { page } from '$app/state';
	import { useQuery, useConvexClient } from 'convex-svelte';
	import { api } from '$lib/convex/_generated/api';
	import type { LayoutData } from './$types';
	import type { Snippet } from 'svelte';

	interface Props {
		children?: Snippet;
		data: LayoutData;
	}

	let { children, data }: Props = $props();

	const client = useConvexClient();

	// Cast viewer to include role field from BetterAuth admin plugin
	const viewer = $derived(data.viewer as typeof data.viewer & { role?: string });

	// Query AI chat threads for sidebar
	const aiChatThreadsQuery = useQuery(api.aiChat.threads.listThreads, {});
	const aiChatThreads = $derived(aiChatThreadsQuery.data?.page ?? []);

	// Pre-warm thread: always keep one empty thread ready for instant "new chat"
	const warmThreadQuery = useQuery(api.aiChat.threads.getWarmThread, {});
	const warmThreadId = $derived(warmThreadQuery.data?.threadId ?? null);

	let ensureWarmInFlight = $state(false);

	$effect(() => {
		if (warmThreadQuery.data === null && !ensureWarmInFlight && viewer) {
			ensureWarmInFlight = true;
			client.mutation(api.aiChat.threads.getOrCreateWarmThread, {}).finally(() => {
				ensureWarmInFlight = false;
			});
		}
	});

	// AI chat page needs fullControl (manages own scroll like admin support)
	const fullControl = $derived(page.url.pathname.includes('/app/ai-chat'));

	// Generate sidebar config based on current page state
	const sidebarConfig = $derived(
		getAppSidebarConfig(
			{ pathname: page.url.pathname, search: page.url.search, lang: page.params.lang },
			viewer?.role,
			aiChatThreads,
			warmThreadId
		)
	);
</script>

<PostHogIdentify />
<SupportTicketMigrationBootstrap />

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
	{fullControl}
>
	{@render children?.()}
</AuthenticatedLayout>
