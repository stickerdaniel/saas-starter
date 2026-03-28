<script lang="ts">
	import PostHogIdentify from '$lib/components/analytics/PostHogIdentify.svelte';
	import SupportTicketMigrationBootstrap from '$lib/components/customer-support/support-ticket-migration-bootstrap.svelte';
	import { AuthenticatedLayout, getAppSidebarConfig } from '$lib/components/authenticated';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { tick } from 'svelte';
	import { localizedHref } from '$lib/utils/i18n';
	import { useQuery, useConvexClient } from 'convex-svelte';
	import { api } from '$lib/convex/_generated/api';
	import { getTranslate } from '@tolgee/svelte';
	import type { LayoutData } from './$types';
	import type { Snippet } from 'svelte';

	const { t } = getTranslate();

	interface Props {
		children?: Snippet;
		data: LayoutData;
	}

	let { children, data }: Props = $props();

	const client = useConvexClient();

	// Cast viewer to include role field from BetterAuth admin plugin
	const viewer = $derived(data.viewer as typeof data.viewer & { role?: string });

	// Query AI chat threads for sidebar
	// Keep previous results while loading more so autoAnimate only adds new items
	let threadLimit = $state(5);
	const aiChatThreadsQuery = useQuery(api.aiChat.threads.listThreads, () => ({
		limit: threadLimit
	}));
	let prevThreads = $state<typeof aiChatThreadsQuery.data>(undefined);
	$effect(() => {
		if (aiChatThreadsQuery.data) {
			prevThreads = aiChatThreadsQuery.data;
		}
	});
	const threadData = $derived(aiChatThreadsQuery.data ?? prevThreads);
	const aiChatThreads = $derived(threadData?.threads ?? []);
	const threadsHasMore = $derived(threadData?.hasMore ?? false);

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

	// Chat pages need fullControl (manage own scroll containers)
	const fullControl = $derived(
		page.url.pathname.includes('/app/ai-chat') || page.url.pathname.includes('/app/community-chat')
	);

	// Keyboard shortcuts for sidebar navigation
	function handleKeydown(e: KeyboardEvent) {
		if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey) return;
		const target = e.target as HTMLElement;
		if (target.closest('input, textarea, [contenteditable]')) return;

		const routes: Record<string, string> = {
			'1': localizedHref('/app/community-chat'),
			'2': warmThreadId
				? localizedHref(`/app/ai-chat?thread=${warmThreadId}`)
				: localizedHref('/app/ai-chat'),
			';': localizedHref('/admin'),
			',': localizedHref('/app/settings')
		};

		const url = routes[e.key];
		if (!url) return;

		e.preventDefault();
		goto(resolve(url)).then(() => {
			// Focus chat input even if already on the page
			tick().then(() => document.querySelector<HTMLTextAreaElement>('textarea')?.focus());
		});
	}

	// Generate sidebar config based on current page state
	const sidebarConfig = $derived(
		getAppSidebarConfig(
			{ pathname: page.url.pathname, search: page.url.search, lang: page.params.lang },
			viewer?.role,
			aiChatThreads,
			warmThreadId,
			$t('ai_chat.thread.no_messages'),
			threadsHasMore,
			() => (threadLimit += 5)
		)
	);
</script>

<svelte:document onkeydown={handleKeydown} />

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
