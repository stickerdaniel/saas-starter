<script lang="ts">
	import { untrack } from 'svelte';
	import { z } from 'zod';
	import { useSearchParams } from 'runed/kit';
	import { Debounced } from 'runed';
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { useQuery, useConvexClient } from 'convex-svelte';
	import { api } from '$lib/convex/_generated/api';
	import type { FunctionReturnType } from 'convex/server';
	import { useMedia } from '$lib/hooks/use-media.svelte';
	import { T } from '@tolgee/svelte';
	import * as Sheet from '$lib/components/ui/sheet';
	import * as Drawer from '$lib/components/ui/drawer';
	import { SlidingPanel } from '$lib/components/ui/sliding-panel';
	import { PaneGroup, Pane, PaneResizer } from 'paneforge';
	import ThreadList from './thread-list.svelte';
	import ThreadChat from './thread-chat.svelte';
	import ThreadDetails from './thread-details.svelte';
	import { adminSupportRefresh } from '$lib/hooks/admin-support-threads.svelte';
	import { adminSupportUI } from '$lib/hooks/admin-support-ui.svelte';
	import { toast } from 'svelte-sonner';

	// Filter state schema (thread managed separately to avoid reload on selection)
	const filterSchema = z.object({
		mode: z.enum(['all', 'unassigned', 'my-inbox']).default('all'),
		status: z.enum(['open', 'done']).default('open'),
		search: z.string().default('')
	});

	// Filter state management via useSearchParams
	const filters = useSearchParams(filterSchema, {
		pushHistory: true,
		noScroll: true
	});

	// Debounce search to avoid API call on every keystroke
	const debouncedSearch = new Debounced(() => filters.search, 300);

	// Thread selection managed separately via $page.url (doesn't trigger filter reactivity)
	const threadId = $derived($page.url.searchParams.get('thread') ?? '');

	// Responsive breakpoints
	const media = useMedia();

	// Get current admin user ID
	const viewer = useQuery(api.users.viewer);
	const adminUserId = $derived(viewer.data?._id);

	// Build filter for query
	const filter = $derived.by((): 'all' | 'unassigned' | { assignedTo: string } => {
		if (filters.mode === 'unassigned') return 'unassigned';
		if (filters.mode === 'my-inbox' && adminUserId) {
			return { assignedTo: adminUserId };
		}
		return 'all';
	});

	// Infinite scroll state
	type ThreadItem = FunctionReturnType<
		typeof api.admin.support.queries.listThreadsForAdmin
	>['page'][number];

	let allThreads = $state<ThreadItem[]>([]);
	let continueCursor = $state<string | null>(null);
	let isDone = $state(false);
	let isLoading = $state(false);

	// Selected thread from already-loaded list (for instant header display)
	const selectedThread = $derived(allThreads.find((t) => t._id === threadId));

	const convexClient = useConvexClient();

	// Load initial page
	async function loadInitialThreads() {
		isLoading = true;
		try {
			const result = await convexClient.query(api.admin.support.queries.listThreadsForAdmin, {
				filter,
				status: filters.status,
				search: debouncedSearch.current || undefined,
				paginationOpts: { numItems: 25, cursor: null }
			});

			allThreads = result.page;
			continueCursor = result.continueCursor;
			isDone = result.isDone;
		} catch (error) {
			console.error('Failed to load threads:', error);
			toast.error('Failed to load support threads');
			allThreads = [];
			continueCursor = null;
			isDone = true;
		} finally {
			isLoading = false;
		}
	}

	// Load more pages (called by InfiniteLoader)
	async function loadMoreThreads(): Promise<void> {
		if (isDone || !continueCursor) return;

		try {
			const result = await convexClient.query(api.admin.support.queries.listThreadsForAdmin, {
				filter,
				status: filters.status,
				search: debouncedSearch.current || undefined,
				paginationOpts: { numItems: 25, cursor: continueCursor }
			});

			allThreads = [...allThreads, ...result.page];
			continueCursor = result.continueCursor;
			isDone = result.isDone;
		} catch (error) {
			console.error('Failed to load more threads:', error);
			toast.error('Failed to load more threads');
		}
	}

	// Track what filter state we've already loaded
	let loadedState = $state({ filterKey: '', refreshTrigger: 0 });

	// Reload when filters ACTUALLY change (not just when useSearchParams re-emits)
	// useSearchParams re-emits on ANY URL change, so we must compare values
	// Note: debouncedSearch.current is used so API calls wait for debounce
	$effect(() => {
		// Create a key from current filter values (using debounced search)
		const currentFilterKey = `${filters.mode}|${filters.status}|${debouncedSearch.current}`;
		const currentRefresh = adminSupportRefresh.refreshTrigger;

		// Compare to what we've already loaded
		const shouldReload =
			currentFilterKey !== loadedState.filterKey || currentRefresh !== loadedState.refreshTrigger;

		if (shouldReload) {
			untrack(() => {
				// Update state BEFORE loading
				loadedState = { filterKey: currentFilterKey, refreshTrigger: currentRefresh };
				adminSupportRefresh.resetLoaders();
				loadInitialThreads();
			});
		}
	});

	// Select thread handler (uses goto to avoid triggering filter reactivity)
	function selectThread(id: string) {
		const url = new URL($page.url);
		url.searchParams.set('thread', id);
		goto(url.toString(), { noScroll: true, replaceState: false });
	}

	function clearThread() {
		const url = new URL($page.url);
		url.searchParams.delete('thread');
		goto(url.toString(), { noScroll: true, replaceState: false });
	}

	// Reset overlay state when thread changes
	$effect(() => {
		if (!threadId) {
			adminSupportUI.close();
		}
	});
</script>

<div class="flex h-full flex-col">
	<!-- Desktop XL (≥1280px): 3 panes with 2 resizers -->
	{#if media.xl}
		<PaneGroup direction="horizontal" autoSaveId="support-3pane" class="h-full">
			<Pane defaultSize={25} minSize={20} maxSize={40}>
				<ThreadList
					filterMode={filters.mode}
					statusFilter={filters.status}
					searchQuery={filters.search}
					threads={allThreads}
					selectedThreadId={threadId}
					{isLoading}
					{isDone}
					onFilterChange={(mode) => (filters.mode = mode)}
					onStatusChange={(status) => (filters.status = status)}
					onSearchChange={(query) => (filters.search = query)}
					onThreadSelect={selectThread}
					onLoadMore={loadMoreThreads}
				/>
			</Pane>

			<PaneResizer
				class="relative z-20 -mx-2.5 w-5 bg-black/0 after:pointer-events-none after:absolute after:inset-y-0 after:left-1/2 after:w-px after:-translate-x-1/2 after:bg-background after:z-0 before:pointer-events-none before:absolute before:inset-y-0 before:left-1/2 before:w-px before:-translate-x-1/2 before:bg-border before:z-10 hover:before:w-0.5 hover:after:w-0.5 data-[resize-handle-active]:before:w-0.5 data-[resize-handle-active]:after:w-0.5"
			/>

			<Pane defaultSize={50} minSize={30}>
				{#if threadId}
					<ThreadChat {threadId} initialThread={selectedThread} />
				{:else}
					<div
						class="flex h-full items-center justify-center text-center text-balance text-muted-foreground"
					>
						<T keyName="admin.support.select_chat" />
					</div>
				{/if}
			</Pane>

			<PaneResizer
				class="relative z-20 -mx-2.5 w-5 bg-black/0 after:pointer-events-none after:absolute after:inset-y-0 after:left-1/2 after:w-px after:-translate-x-1/2 after:bg-background after:z-0 before:pointer-events-none before:absolute before:inset-y-0 before:left-1/2 before:w-px before:-translate-x-1/2 before:bg-border before:z-10 hover:before:w-0.5 hover:after:w-0.5 data-[resize-handle-active]:before:w-0.5 data-[resize-handle-active]:after:w-0.5"
			/>

			<Pane defaultSize={25} minSize={15} maxSize={40}>
				{#if threadId}
					<ThreadDetails {threadId} />
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
					{isLoading}
					{isDone}
					onFilterChange={(mode) => (filters.mode = mode)}
					onStatusChange={(status) => (filters.status = status)}
					onSearchChange={(query) => (filters.search = query)}
					onThreadSelect={selectThread}
					onLoadMore={loadMoreThreads}
				/>
			</Pane>

			<PaneResizer
				class="relative z-20 -mx-2.5 w-5 bg-black/0 after:pointer-events-none after:absolute after:inset-y-0 after:left-1/2 after:w-px after:-translate-x-1/2 after:bg-background after:z-0 before:pointer-events-none before:absolute before:inset-y-0 before:left-1/2 before:w-px before:-translate-x-1/2 before:bg-border before:z-10 hover:before:w-0.5 hover:after:w-0.5 data-[resize-handle-active]:before:w-0.5 data-[resize-handle-active]:after:w-0.5"
			/>

			<Pane defaultSize={70} minSize={50}>
				{#if threadId}
					<ThreadChat {threadId} initialThread={selectedThread} />
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
				{isLoading}
				{isDone}
				onFilterChange={(mode) => (filters.mode = mode)}
				onStatusChange={(status) => (filters.status = status)}
				onSearchChange={(query) => (filters.search = query)}
				onThreadSelect={selectThread}
				onLoadMore={loadMoreThreads}
			/>

			<!-- Chat (slides over thread list from right) -->
			<SlidingPanel open={!!threadId} class="bg-background">
				{#if threadId}
					<ThreadChat {threadId} initialThread={selectedThread} onBackClick={clearThread} />
				{/if}
			</SlidingPanel>
		</div>
	{/if}

	<!-- Tablet/Desktop LG (≥640px, <1280px): Sheet overlay from right -->
	{#if threadId && media.sm && !media.xl}
		<Sheet.Root bind:open={adminSupportUI.detailsOpen}>
			<Sheet.Content side="right" class="w-80 p-0">
				<ThreadDetails {threadId} />
			</Sheet.Content>
		</Sheet.Root>
	{/if}

	<!-- Mobile (<640px): Bottom drawer -->
	{#if threadId && !media.sm}
		<Drawer.Root bind:open={adminSupportUI.detailsOpen} direction="bottom">
			<Drawer.Content class="h-[85svh] p-0">
				<ThreadDetails {threadId} />
			</Drawer.Content>
		</Drawer.Root>
	{/if}
</div>
