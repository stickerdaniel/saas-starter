<script lang="ts">
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { useQuery } from 'convex-svelte';
	import { api } from '$lib/convex/_generated/api';
	import { Debounced } from 'runed';
	import { useMedia } from '$lib/hooks/use-media.svelte';
	import { T } from '@tolgee/svelte';
	import * as Sheet from '$lib/components/ui/sheet';
	import * as Drawer from '$lib/components/ui/drawer';
	import { SlidingPanel } from '$lib/components/ui/sliding-panel';
	import { PaneGroup, Pane, PaneResizer } from 'paneforge';
	import ThreadList from './thread-list.svelte';
	import ThreadChat from './thread-chat.svelte';
	import ThreadDetails from './thread-details.svelte';

	// URL state management
	const threadId = $derived($page.url.searchParams.get('thread'));

	// Filter state
	let filterMode = $state<'all' | 'unassigned' | 'my-inbox'>('all');
	let statusFilter = $state<'open' | 'done' | undefined>();
	let searchQuery = $state('');
	const debouncedSearch = new Debounced(() => searchQuery, 300);

	// Responsive breakpoints
	const media = useMedia();

	// Sheet/Drawer overlay state (<1280px)
	let detailsOpen = $state(false);

	// Get current admin user ID
	const viewer = useQuery(api.users.viewer);
	const adminUserId = $derived(viewer.data?._id);

	// Build filter for query
	const filter = $derived.by((): 'all' | 'unassigned' | { assignedTo: string } => {
		if (filterMode === 'unassigned') return 'unassigned';
		if (filterMode === 'my-inbox' && adminUserId) {
			return { assignedTo: adminUserId };
		}
		return 'all';
	});

	// Query threads
	const threadsQuery = useQuery(api.admin.support.queries.listThreadsForAdmin, () => ({
		filter,
		status: statusFilter,
		search: debouncedSearch.current || undefined,
		paginationOpts: { numItems: 50, cursor: null }
	}));

	// Select thread handler
	function selectThread(id: string) {
		goto(`?thread=${id}`, { replaceState: false, keepFocus: true });
	}

	function clearThread() {
		goto($page.url.pathname, { replaceState: false, keepFocus: true });
	}

	// Toggle Sheet/Drawer overlay (<1280px)
	function toggleDetailsOverlay() {
		detailsOpen = !detailsOpen;
	}

	// Reset overlay state when thread changes
	$effect(() => {
		if (!threadId) {
			detailsOpen = false;
		}
	});
</script>

<div class="flex h-full flex-col">
	<!-- Desktop XL (≥1280px): 3 panes with 2 resizers -->
	{#if media.xl}
		<PaneGroup direction="horizontal" autoSaveId="support-3pane" class="h-full">
			<Pane defaultSize={25} minSize={20} maxSize={40}>
				<ThreadList
					{filterMode}
					{statusFilter}
					{searchQuery}
					threads={threadsQuery.data?.page}
					selectedThreadId={threadId}
					onFilterChange={(mode) => (filterMode = mode)}
					onStatusChange={(status) => (statusFilter = status)}
					onSearchChange={(query) => (searchQuery = query)}
					onThreadSelect={selectThread}
				/>
			</Pane>

			<PaneResizer class="w-1.5 bg-border transition-colors hover:bg-primary/50" />

			<Pane defaultSize={50} minSize={30}>
				{#if threadId}
					<ThreadChat {threadId} {detailsOpen} onToggleOverlay={toggleDetailsOverlay} />
				{:else}
					<div
						class="flex h-full items-center justify-center text-center text-balance text-muted-foreground"
					>
						<T keyName="admin.support.select_chat" />
					</div>
				{/if}
			</Pane>

			<PaneResizer class="w-1.5 bg-border transition-colors hover:bg-primary/50" />

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
					{filterMode}
					{statusFilter}
					{searchQuery}
					threads={threadsQuery.data?.page}
					selectedThreadId={threadId}
					onFilterChange={(mode) => (filterMode = mode)}
					onStatusChange={(status) => (statusFilter = status)}
					onSearchChange={(query) => (searchQuery = query)}
					onThreadSelect={selectThread}
				/>
			</Pane>

			<PaneResizer class="w-1.5 bg-border transition-colors hover:bg-primary/50" />

			<Pane defaultSize={70} minSize={50}>
				{#if threadId}
					<ThreadChat {threadId} {detailsOpen} onToggleOverlay={toggleDetailsOverlay} />
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
				{filterMode}
				{statusFilter}
				{searchQuery}
				threads={threadsQuery.data?.page}
				selectedThreadId={threadId}
				onFilterChange={(mode) => (filterMode = mode)}
				onStatusChange={(status) => (statusFilter = status)}
				onSearchChange={(query) => (searchQuery = query)}
				onThreadSelect={selectThread}
			/>

			<!-- Chat (slides over thread list from right) -->
			<SlidingPanel open={!!threadId} class="bg-background">
				{#if threadId}
					<ThreadChat
						{threadId}
						{detailsOpen}
						onToggleOverlay={toggleDetailsOverlay}
						onBackClick={clearThread}
					/>
				{/if}
			</SlidingPanel>
		</div>
	{/if}

	<!-- Tablet/Desktop LG (≥640px, <1280px): Sheet overlay from right -->
	{#if threadId && media.sm && !media.xl}
		<Sheet.Root bind:open={detailsOpen}>
			<Sheet.Content side="right" class="w-80 p-0">
				<ThreadDetails {threadId} />
			</Sheet.Content>
		</Sheet.Root>
	{/if}

	<!-- Mobile (<640px): Bottom drawer -->
	{#if threadId && !media.sm}
		<Drawer.Root bind:open={detailsOpen} direction="bottom">
			<Drawer.Content class="max-h-[90vh] p-0">
				<ThreadDetails {threadId} />
			</Drawer.Content>
		</Drawer.Root>
	{/if}
</div>
