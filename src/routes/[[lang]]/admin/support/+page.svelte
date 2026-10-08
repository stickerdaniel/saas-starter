<script lang="ts">
	import { onDestroy } from 'svelte';
	import SEOHead from '#lib/components/SEOHead.svelte';
	import * as v from 'valibot';
	import { useSearchParams } from 'runed/kit';
	import { Debounced, watch } from 'runed';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { useQuery, usePaginatedQuery } from 'convex-svelte';
	import { api } from '#lib/convex/_generated/api.js';
	import { useMedia } from '#lib/hooks/use-media.svelte.ts';
	import { T, getTranslate } from '@tolgee/svelte';
	import * as Sheet from '#lib/components/ui/sheet/index.js';
	import * as Drawer from '#lib/components/ui/drawer/index.js';
	import { SlidingPanel } from '#lib/components/ui/sliding-panel/index.js';
	import { PaneGroup, Pane, PaneResizer } from 'paneforge';
	import ThreadList from './thread-list.svelte';
	import ThreadChat from './thread-chat.svelte';
	import ThreadDetails from './thread-details.svelte';
	import {
		AdminSupportUIManager,
		adminSupportUIContext
	} from '#lib/hooks/admin-support-ui.svelte.ts';
	import { adminCache } from '#lib/hooks/admin-cache.svelte.ts';
	import { ChatDraftManager } from '#lib/chat/index.js';
	import {
		ComposerSendCoordinator,
		acquireComposerSendCoordinator
	} from '#lib/chat/ui/composer-send-coordinator.ts';
	import { browser } from '$app/env';
	import { authClient } from '#lib/auth-client.js';

	const { t } = getTranslate();

	// Per-request overlay state shared with thread-chat via context
	const adminSupportUI = adminSupportUIContext.set(new AdminSupportUIManager());

	// Draft persistence and send settlement live outside {#key threadId}, so drafts
	// and a reply refused after its thread was left survive thread switches, and
	// outside this page while one of its replies is open. A session that ends
	// while the page stays open hands over the next session's owner, and the
	// thread view is rebuilt around it below.
	let sendLease = $state.raw(
		acquireComposerSendCoordinator(
			'admin-support',
			() => new ComposerSendCoordinator({ drafts: new ChatDraftManager('admin-support') }),
			(next) => (sendLease = next)
		)
	);
	onDestroy(() => sendLease.release());

	// Filter state schema (thread managed separately to avoid reload on selection)
	const filterSchema = v.object({
		mode: v.optional(v.fallback(v.picklist(['all', 'unassigned', 'my-inbox']), 'all'), 'all'),
		status: v.optional(v.fallback(v.picklist(['open', 'done']), 'open'), 'open'),
		search: v.optional(v.fallback(v.string(), ''), '')
	});

	// Filter state management via useSearchParams
	const filters = useSearchParams(filterSchema, {
		pushHistory: true,
		noScroll: true
	});

	// Debounce search to avoid API call on every keystroke
	const debouncedSearch = new Debounced(() => filters.search, 300);

	// Thread selection managed separately via page.url (doesn't trigger filter reactivity)
	const threadId = $derived(page.url.searchParams.get('thread') ?? '');

	// Responsive breakpoints
	const media = useMedia();

	// Get current admin user ID
	const viewer = useQuery(api.users.viewer);
	const adminUserId = $derived(viewer.data?._id);
	const canImpersonate = $derived(
		authClient.admin.checkRolePermission({
			role: viewer.data?.role === 'admin' ? 'admin' : 'user',
			permissions: { user: ['impersonate'] }
		})
	);

	// Build filter for query
	const filter = $derived.by((): 'all' | 'unassigned' | { assignedTo: string } => {
		if (filters.mode === 'unassigned') return 'unassigned';
		if (filters.mode === 'my-inbox' && adminUserId) {
			return { assignedTo: adminUserId };
		}
		return 'all';
	});

	// The list query's arguments. The selected thread stays out: opening a thread
	// does not change which threads are listed.
	const threadsArgs = $derived({
		filter,
		status: filters.status,
		search: debouncedSearch.current || undefined
	});

	// Changes exactly when the subscription does, including when "my inbox"
	// switches from all threads to the viewer's once the viewer has loaded.
	const threadsQueryIdentity = $derived(JSON.stringify(threadsArgs));

	// Reactive paginated query for threads - automatically updates when filters change
	const threadsQuery = usePaginatedQuery(
		api.admin.support.queries.listThreadsForAdmin,
		() => threadsArgs,
		{ initialNumItems: 25, keepPreviousData: true }
	);

	// Derived state for template compatibility
	const allThreads = $derived(threadsQuery.results);
	const isLoading = $derived(threadsQuery.isLoading);
	const loadError = $derived(threadsQuery.error);

	// Selected thread from already-loaded list (for instant header display)
	const selectedThread = $derived(allThreads.find((t) => t._id === threadId));

	// Cache key for current filter combination (status:mode)
	const cacheKey = $derived(`${filters.status}:${filters.mode}`);

	// Get cached thread count for current filter (only when no search active)
	const cachedThreadCount = $derived(
		!debouncedSearch.current ? adminCache.supportThreadCounts.current[cacheKey] : undefined
	);

	// Update cache when loading finishes or thread count changes, only without search
	watch(
		() => ({
			search: debouncedSearch.current,
			loading: isLoading,
			key: cacheKey,
			count: allThreads.length
		}),
		({ search, loading, key, count }) => {
			if (search || loading) return;

			const currentCache = adminCache.supportThreadCounts.current;
			if (currentCache[key] !== count) {
				adminCache.supportThreadCounts.current = {
					...currentCache,
					[key]: count
				};
			}
		}
	);

	// Load more handler for infinite scroll
	function loadMoreThreads(numItems: number): boolean {
		return threadsQuery.loadMore(numItems);
	}

	// Select thread handler (uses goto to avoid triggering filter reactivity)
	function selectThread(id: string) {
		const url = new URL(page.url.href);
		url.searchParams.set('thread', id);
		goto(resolve(url.pathname + url.search), { reset: false });
	}

	function clearThread() {
		const url = new URL(page.url.href);
		url.searchParams.delete('thread');
		goto(resolve(url.pathname + url.search), { reset: false });
	}

	// Reset overlay state when thread changes
	$effect(() => {
		if (!threadId) {
			adminSupportUI.close();
		}
	});
</script>

<SEOHead
	title={$t('meta.admin.support.title')}
	description={$t('meta.admin.support.description')}
	noindex
/>

<div class="flex h-full flex-col">
	<!-- Wait for browser to resolve media queries — prevents layout flash from SSR fallback -->
	{#if !browser}
		<div class="h-full"></div>
	{:else if media.xl}
		<PaneGroup direction="horizontal" autoSaveId="support-3pane" class="h-full">
			<Pane defaultSize={25} minSize={20} maxSize={40}>
				<ThreadList
					filterMode={filters.mode}
					statusFilter={filters.status}
					searchQuery={filters.search}
					threads={allThreads}
					selectedThreadId={threadId}
					status={threadsQuery.status}
					{isLoading}
					error={loadError}
					queryIdentity={threadsQueryIdentity}
					cachedCount={cachedThreadCount}
					onFilterChange={(mode) => (filters.mode = mode)}
					onStatusChange={(status) => (filters.status = status)}
					onSearchChange={(query) => (filters.search = query)}
					onThreadSelect={selectThread}
					onLoadMore={loadMoreThreads}
				/>
			</Pane>

			<PaneResizer
				class="relative z-20 -mx-2.5 w-5 bg-black/0 before:pointer-events-none before:absolute before:inset-y-0 before:left-1/2 before:z-10 before:w-px before:-translate-x-1/2 before:bg-border after:pointer-events-none after:absolute after:inset-y-0 after:left-1/2 after:z-0 after:w-px after:-translate-x-1/2 after:bg-background hover:before:w-0.5 hover:after:w-0.5 data-[resize-handle-active]:before:w-0.5 data-[resize-handle-active]:after:w-0.5"
			/>

			<Pane defaultSize={50} minSize={30}>
				{#if threadId}
					{#key sendLease.owner}
						{#key threadId}
							<ThreadChat
								{threadId}
								initialThread={selectedThread}
								{canImpersonate}
								viewerId={adminUserId}
								sendOwner={sendLease.owner}
							/>
						{/key}
					{/key}
				{:else}
					<div
						class="flex h-full items-center justify-center text-center text-balance text-muted-foreground"
					>
						<T keyName="admin.support.select_chat" />
					</div>
				{/if}
			</Pane>

			<PaneResizer
				class="relative z-20 -mx-2.5 w-5 bg-black/0 before:pointer-events-none before:absolute before:inset-y-0 before:left-1/2 before:z-10 before:w-px before:-translate-x-1/2 before:bg-border after:pointer-events-none after:absolute after:inset-y-0 after:left-1/2 after:z-0 after:w-px after:-translate-x-1/2 after:bg-background hover:before:w-0.5 hover:after:w-0.5 data-[resize-handle-active]:before:w-0.5 data-[resize-handle-active]:after:w-0.5"
			/>

			<Pane defaultSize={25} minSize={15} maxSize={40}>
				{#if threadId}
					<ThreadDetails {threadId} {canImpersonate} viewerId={adminUserId} />
				{:else}
					<div
						class="flex h-full items-center justify-center text-center text-balance text-muted-foreground"
					>
						<T keyName="admin.support.select_chat_for_details" />
					</div>
				{/if}
			</Pane>
		</PaneGroup>

		<!-- Desktop LG (≥1024px, <1280px): 2 panes with 1 resizer + Sheet for details -->
	{:else if media.lg}
		<PaneGroup direction="horizontal" autoSaveId="support-2pane" class="h-full">
			<Pane defaultSize={30} minSize={20} maxSize={50}>
				<ThreadList
					filterMode={filters.mode}
					statusFilter={filters.status}
					searchQuery={filters.search}
					threads={allThreads}
					selectedThreadId={threadId}
					status={threadsQuery.status}
					{isLoading}
					error={loadError}
					queryIdentity={threadsQueryIdentity}
					cachedCount={cachedThreadCount}
					onFilterChange={(mode) => (filters.mode = mode)}
					onStatusChange={(status) => (filters.status = status)}
					onSearchChange={(query) => (filters.search = query)}
					onThreadSelect={selectThread}
					onLoadMore={loadMoreThreads}
				/>
			</Pane>

			<PaneResizer
				class="relative z-20 -mx-2.5 w-5 bg-black/0 before:pointer-events-none before:absolute before:inset-y-0 before:left-1/2 before:z-10 before:w-px before:-translate-x-1/2 before:bg-border after:pointer-events-none after:absolute after:inset-y-0 after:left-1/2 after:z-0 after:w-px after:-translate-x-1/2 after:bg-background hover:before:w-0.5 hover:after:w-0.5 data-[resize-handle-active]:before:w-0.5 data-[resize-handle-active]:after:w-0.5"
			/>

			<Pane defaultSize={70} minSize={50}>
				{#if threadId}
					{#key sendLease.owner}
						{#key threadId}
							<ThreadChat
								{threadId}
								initialThread={selectedThread}
								{canImpersonate}
								viewerId={adminUserId}
								sendOwner={sendLease.owner}
							/>
						{/key}
					{/key}
				{:else}
					<div
						class="flex h-full items-center justify-center text-center text-balance text-muted-foreground"
					>
						<T keyName="admin.support.select_chat" />
					</div>
				{/if}
			</Pane>
		</PaneGroup>

		<!-- Mobile (<1024px): Thread list + sliding chat -->
	{:else}
		<div class="relative h-full overflow-hidden">
			<!-- Thread List (always visible, covered by sliding panel) -->
			<ThreadList
				filterMode={filters.mode}
				statusFilter={filters.status}
				searchQuery={filters.search}
				threads={allThreads}
				selectedThreadId={threadId}
				status={threadsQuery.status}
				{isLoading}
				error={loadError}
				queryIdentity={threadsQueryIdentity}
				cachedCount={cachedThreadCount}
				onFilterChange={(mode) => (filters.mode = mode)}
				onStatusChange={(status) => (filters.status = status)}
				onSearchChange={(query) => (filters.search = query)}
				onThreadSelect={selectThread}
				onLoadMore={loadMoreThreads}
			/>

			<!-- Chat (slides over thread list from right) -->
			<SlidingPanel open={!!threadId} surface="background">
				{#if threadId}
					{#key sendLease.owner}
						{#key threadId}
							<ThreadChat
								{threadId}
								initialThread={selectedThread}
								{canImpersonate}
								viewerId={adminUserId}
								onBackClick={clearThread}
								sendOwner={sendLease.owner}
							/>
						{/key}
					{/key}
				{/if}
			</SlidingPanel>
		</div>
	{/if}

	<!-- Tablet/Desktop LG (≥640px, <1280px): Sheet overlay from right -->
	{#if threadId && media.sm && !media.xl}
		<Sheet.Root bind:open={adminSupportUI.detailsOpen}>
			<Sheet.Content side="right" class="w-80 p-0">
				<ThreadDetails {threadId} {canImpersonate} viewerId={adminUserId} />
			</Sheet.Content>
		</Sheet.Root>
	{/if}

	<!-- Mobile (<640px): Bottom drawer -->
	{#if threadId && !media.sm}
		<Drawer.Root bind:open={adminSupportUI.detailsOpen} direction="bottom">
			<Drawer.Content class="h-[85svh] p-0">
				<ThreadDetails {threadId} {canImpersonate} viewerId={adminUserId} />
			</Drawer.Content>
		</Drawer.Root>
	{/if}
</div>
