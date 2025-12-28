<script lang="ts">
	import { Input } from '$lib/components/ui/input';
	import * as Tabs from '$lib/components/ui/tabs';
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import { Avatar, AvatarFallback } from '$lib/components/ui/avatar';
	import { Skeleton } from '$lib/components/ui/skeleton';
	import SearchIcon from '@lucide/svelte/icons/search';
	import InboxIcon from '@lucide/svelte/icons/inbox';
	import ArchiveIcon from '@lucide/svelte/icons/archive';
	import { formatDistanceToNow } from 'date-fns';
	import { T } from '@tolgee/svelte';

	interface Thread {
		_id: string;
		_creationTime: number;
		userId?: string;
		title?: string;
		summary?: string;
		status: 'active' | 'archived';
		supportMetadata: {
			_id: string;
			_creationTime: number;
			threadId: string;
			userId?: string;
			status: 'open' | 'done';
			assignedTo?: string;
			priority?: 'low' | 'medium' | 'high';
			dueDate?: number;
			pageUrl?: string;
			unreadByAdmin: boolean;
			createdAt: number;
			updatedAt: number;
		};
		lastMessage?: string;
		lastMessageAt?: number;
		userName?: string;
		userEmail?: string;
	}

	let {
		filterMode,
		statusFilter,
		searchQuery,
		threads = [],
		selectedThreadId,
		onFilterChange,
		onStatusChange,
		onSearchChange,
		onThreadSelect
	}: {
		filterMode: 'all' | 'unassigned' | 'my-inbox';
		statusFilter?: 'open' | 'done'; // Only new statuses for filter
		searchQuery: string;
		threads?: Thread[];
		selectedThreadId: string | null;
		onFilterChange: (mode: 'all' | 'unassigned' | 'my-inbox') => void;
		onStatusChange: (status?: 'open' | 'done') => void;
		onSearchChange: (query: string) => void;
		onThreadSelect: (id: string) => void;
	} = $props();

	const isLoading = $derived(threads === undefined);

	// Local state for toggle (true = showing open, false = showing done)
	let showingOpen = $state(statusFilter === 'open' || statusFilter === undefined);

	// Sync with external statusFilter changes
	$effect(() => {
		showingOpen = statusFilter === 'open' || statusFilter === undefined;
	});

	// Apply default "open" filter on mount
	$effect(() => {
		if (statusFilter === undefined) {
			onStatusChange('open');
		}
	});

	function toggleFilter() {
		showingOpen = !showingOpen;
		onStatusChange(showingOpen ? 'open' : 'done');
	}
</script>

<div class="flex h-full flex-col">
	<!-- Filters -->
	<div class="flex-shrink-0 space-y-3 border-b p-4">
		<!-- Search & Status Filter Row -->
		<div class="flex gap-3">
			<!-- Search -->
			<div class="relative flex-1">
				<SearchIcon class="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
				<Input
					placeholder="Search chats..."
					class="pl-10"
					value={searchQuery}
					oninput={(e) => onSearchChange(e.currentTarget.value)}
				/>
			</div>

			<!-- Status Filter (Animated Toggle) -->
			<Button onclick={toggleFilter} variant="outline" size="icon">
				<InboxIcon
					class="size-4 transition-all duration-200 ease-in-out {showingOpen
						? 'blur-0 scale-100 opacity-100'
						: 'scale-0 opacity-0 blur-sm'}"
				/>
				<ArchiveIcon
					class="absolute size-4 transition-all duration-200 ease-in-out {showingOpen
						? 'scale-0 opacity-0 blur-sm'
						: 'blur-0 scale-100 opacity-100'}"
				/>
				<span class="sr-only">Toggle status filter</span>
			</Button>
		</div>

		<!-- Filter Tabs -->
		<Tabs.Root
			value={filterMode}
			onValueChange={(v) => onFilterChange(v as 'all' | 'unassigned' | 'my-inbox')}
		>
			<Tabs.List class="grid w-full grid-cols-3">
				<Tabs.Trigger value="my-inbox"><T keyName="admin.support.filter.my_inbox" /></Tabs.Trigger>
				<Tabs.Trigger value="all"><T keyName="admin.support.filter.all" /></Tabs.Trigger>
				<Tabs.Trigger value="unassigned"
					><T keyName="admin.support.filter.unassigned" /></Tabs.Trigger
				>
			</Tabs.List>
		</Tabs.Root>
	</div>

	<!-- Thread List -->
	<div class="flex-1 overflow-y-auto">
		{#if isLoading}
			<!-- Loading skeletons -->
			{#each Array(5) as _, i (i)}
				<div class="border-b p-4">
					<div class="flex items-start gap-3">
						<Skeleton class="size-10 rounded-full" />
						<div class="flex-1 space-y-2">
							<Skeleton class="h-4 w-32" />
							<Skeleton class="h-3 w-full" />
							<div class="flex gap-2">
								<Skeleton class="h-5 w-12 rounded-md" />
								<Skeleton class="h-5 w-12 rounded-md" />
							</div>
						</div>
					</div>
				</div>
			{/each}
		{:else if threads && threads.length > 0}
			{#each threads as thread (thread._id)}
				<button
					class="w-full border-b p-4 text-left {thread._id === selectedThreadId
						? 'bg-muted/70'
						: 'hover:bg-muted/30'}"
					onclick={() => onThreadSelect(thread._id)}
				>
					<div class="flex items-start gap-3">
						<!-- Avatar -->
						<Avatar class="size-10">
							<AvatarFallback>
								{thread.userName?.[0]?.toUpperCase() || 'U'}
							</AvatarFallback>
						</Avatar>

						<div class="min-w-0 flex-1">
							<!-- Name & Time -->
							<div class="mb-1 flex items-center justify-between gap-2">
								<span class="truncate font-medium">
									{thread.userName || thread.userEmail || 'Anonymous'}
								</span>
								<span class="text-xs text-muted-foreground">
									{formatDistanceToNow(new Date(thread.lastMessageAt || thread._creationTime), {
										addSuffix: true
									})}
								</span>
							</div>

							<!-- Last Message Preview -->
							<p class="truncate text-sm text-muted-foreground">
								{thread.lastMessage || 'No messages'}
							</p>

							<!-- Badges -->
							<div class="mt-2 flex flex-wrap items-center gap-1.5">
								{#if thread.supportMetadata.unreadByAdmin}
									<Badge variant="default" class="text-xs">New</Badge>
								{/if}
								{#if thread.supportMetadata.priority}
									<Badge variant="outline" class="text-xs capitalize"
										>{thread.supportMetadata.priority}</Badge
									>
								{/if}
								{#if thread.supportMetadata.status}
									<Badge variant="secondary" class="text-xs capitalize"
										>{thread.supportMetadata.status}</Badge
									>
								{/if}
							</div>
						</div>
					</div>
				</button>
			{/each}
		{:else}
			<div class="flex h-full items-center justify-center p-8 text-center text-muted-foreground">
				<T keyName={showingOpen ? 'admin.support.no_open_chats' : 'admin.support.no_done_chats'} />
			</div>
		{/if}
	</div>
</div>
