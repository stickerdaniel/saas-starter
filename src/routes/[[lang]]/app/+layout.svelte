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
	const viewer = $derived(data.viewer as typeof data.viewer & { role?: string });

	// AI chat threads for sidebar.
	// Load a generous batch upfront; display limit is managed client-side
	// inside SidebarThreadList (same pattern as t3code) so "Show more"
	// never triggers a server re-fetch or parent re-render.
	const threadsQuery = useQuery(api.aiChat.threads.listThreads, () => ({ limit: 50 }));
	const aiChatThreads = $derived(threadsQuery.data?.threads ?? []);

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

	// Keyboard shortcuts for sidebar navigation (⌃⇧1-2, ⌘., ⌘,)
	function handleKeydown(e: KeyboardEvent) {
		const target = e.target as HTMLElement;
		if (target.closest('input, textarea, [contenteditable]')) return;

		let url: string | undefined;

		// Ctrl+Shift+number for sidebar nav (avoids macOS ⌘⇧3/4 screenshot conflict)
		if (e.ctrlKey && e.shiftKey && !e.altKey && !e.metaKey) {
			const shiftRoutes: Record<string, string> = {
				Digit1: localizedHref('/app/community-chat'),
				Digit2: localizedHref(warmThreadId ? `/app/ai-chat?thread=${warmThreadId}` : '/app/ai-chat')
			};
			url = shiftRoutes[e.code];
		} else if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey) {
			const plainRoutes: Record<string, string> = {
				'.': localizedHref('/admin'),
				',': localizedHref('/app/settings')
			};
			url = plainRoutes[e.key];
		}

		if (!url) return;

		e.preventDefault();
		goto(resolve(url)).then(() => {
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
			$t('ai_chat.thread.no_messages')
		)
	);

	// Thread sub-items passed as separate prop to avoid snippet re-render
	// destroying autoAnimate DOM nodes (see authenticated-sidebar.svelte)
	const threadSubItems: import('$lib/components/authenticated/types').NavSubItem[] = $derived(
		sidebarConfig.navItems.find((i) => i.collapsible)?.subItems ?? []
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
	{threadSubItems}
>
	{@render children?.()}
</AuthenticatedLayout>
