<script lang="ts">
	import { Input } from '$lib/components/ui/input';
	import * as Tabs from '$lib/components/ui/tabs';
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import { Avatar, AvatarFallback, AvatarImage } from '$lib/components/ui/avatar';
	import { Skeleton } from '$lib/components/ui/skeleton';
	import SearchIcon from '@lucide/svelte/icons/search';
	import InboxIcon from '@lucide/svelte/icons/inbox';
	import ArchiveIcon from '@lucide/svelte/icons/archive';
	import Loader2Icon from '@lucide/svelte/icons/loader-2';
	import { formatDistanceToNow } from 'date-fns';
	import { T, getTranslate } from '@tolgee/svelte';
	import { InfiniteLoader, LoaderState } from 'svelte-infinite';

	const { t } = getTranslate();

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
			isHandedOff?: boolean;
			awaitingAdminResponse?: boolean;
			priority?: 'low' | 'medium' | 'high';
			pageUrl?: string;
			createdAt: number;
			updatedAt: number;
		};
		lastMessage?: string;
		lastMessageAt?: number;
		userName?: string;
		userEmail?: string;
		userImage?: string;
	}

	let {
		filterMode,
		statusFilter,
		searchQuery,
		threads = [],
		selectedThreadId,
		isLoading = false,
		isDone = false,
		cachedCount,
		onFilterChange,
		onStatusChange,
		onSearchChange,
		onThreadSelect,
		onLoadMore
	}: {
		filterMode: 'all' | 'unassigned' | 'my-inbox';
		statusFilter: 'open' | 'done';
		searchQuery: string;
		threads?: Thread[];
		selectedThreadId: string | null | undefined;
		isLoading?: boolean;
		isDone?: boolean;
		cachedCount?: number;
		onFilterChange: (mode: 'all' | 'unassigned' | 'my-inbox') => void;
		onStatusChange: (status: 'open' | 'done') => void;
		onSearchChange: (query: string) => void;
		onThreadSelect: (id: string) => void;
		onLoadMore: (numItems: number) => boolean;
	} = $props();

	// Skeleton count: use cached count or default to 6
	const skeletonCount = $derived(cachedCount ?? 6);

	// Create loader state instance for svelte-infinite
	const loaderState = new LoaderState();

	// Derived state for toggle (true = showing open, false = showing done)
	let showingOpen = $derived(statusFilter === 'open');

	function toggleFilter() {
		onStatusChange(showingOpen ? 'done' : 'open');
	}

	// Trigger load function for InfiniteLoader
	async function triggerLoad() {
		const canLoadMore = onLoadMore(25);
		if (!canLoadMore) {
			loaderState.complete();
		} else {
			loaderState.loaded();
		}
	}

	// Reset loader when isDone changes to false (new query started)
	let prevIsDone = $state(isDone);
	$effect(() => {
		if (prevIsDone && !isDone) {
			// Query was reset (filters changed), reset loader state
			loaderState.reset();
		}
		prevIsDone = isDone;
	});
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
					placeholder={$t('admin.support.search.placeholder')}
					class="pl-10"
					value={searchQuery}
					oninput={(e) => onSearchChange(e.currentTarget.value)}
				/>
			</div>

			<!-- Status Filter (Animated Toggle) -->
			<Button
				onclick={toggleFilter}
				variant="outline"
				size="icon"
				aria-label={showingOpen
					? 'Showing open threads, click to show completed'
					: 'Showing completed threads, click to show open'}
			>
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
	<div class="relative flex-1">
		{#if isLoading}
			<!-- Loading skeletons -->
			<div class="scrollbar-thin absolute inset-0 overflow-y-auto">
				{#each Array(skeletonCount) as _, i (i)}
					<div class="border-b p-4">
						<div class="flex items-start gap-3">
							<!-- Avatar -->
							<Skeleton class="size-8 rounded-full" />

							<div class="min-w-0 flex-1">
								<!-- Name & Time -->
								<div class="mb-1 flex items-center justify-between gap-2">
									<Skeleton class="h-6 w-28" />
									<Skeleton class="h-4 w-16" />
								</div>

								<!-- Last Message Preview -->
								<Skeleton class="h-5 w-full" />

								<!-- Badges -->
								<div class="mt-2 flex flex-wrap items-center gap-1.5">
									<Skeleton class="h-[22px] w-10" />
									<Skeleton class="h-[22px] w-10" />
								</div>
							</div>
						</div>
					</div>
				{/each}
			</div>
		{:else if threads && threads.length > 0}
			<div class="scrollbar-thin absolute inset-0 overflow-x-hidden overflow-y-auto">
				<InfiniteLoader
					{loaderState}
					{triggerLoad}
					intersectionOptions={{ rootMargin: '0px 0px 200px 0px' }}
				>
					{#each threads as thread (thread._id)}
						<button
							class="w-full border-b p-4 text-left {thread._id === selectedThreadId
								? 'bg-muted/70'
								: 'hover:bg-muted/30'}"
							onclick={() => thread._id !== selectedThreadId && onThreadSelect(thread._id)}
						>
							<div class="flex items-start gap-3">
								<!-- Avatar -->
								<Avatar class="size-8">
									{#if thread.userImage}
										<AvatarImage src={thread.userImage} alt={thread.userName || 'User'} />
									{/if}
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
										<span class="text-xs whitespace-nowrap text-muted-foreground">
											{formatDistanceToNow(new Date(thread.lastMessageAt || thread._creationTime), {
												addSuffix: true
											})}
										</span>
									</div>

									<!-- Last Message Preview -->
									<p class="truncate text-sm text-muted-foreground">
										{thread.lastMessage || $t('admin.support.thread.no_messages')}
									</p>

									<!-- Badges -->
									<div class="mt-2 flex flex-wrap items-center gap-1.5">
										{#if thread.supportMetadata.awaitingAdminResponse}
											<Badge variant="default" class="text-xs"
												><T keyName="admin.support.thread.badge.new" /></Badge
											>
										{/if}
										{#if thread.supportMetadata.priority}
											<Badge
												variant="outline"
												class="text-xs capitalize {thread.supportMetadata.priority === 'low'
													? 'border-green-500 bg-green-500/10 text-green-700 dark:text-green-400'
													: thread.supportMetadata.priority === 'medium'
														? 'border-yellow-500 bg-yellow-500/10 text-yellow-700 dark:text-yellow-400'
														: 'border-red-500 bg-red-500/10 text-red-700 dark:text-red-400'}"
											>
												{thread.supportMetadata.priority}
											</Badge>
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

					{#snippet loading()}
						<div class="flex items-center justify-center border-b p-4">
							<Loader2Icon class="size-5 animate-spin text-muted-foreground" />
							<span class="ml-2 text-sm text-muted-foreground"
								><T keyName="admin.support.thread.loading" /></span
							>
						</div>
					{/snippet}

					{#snippet error(attemptLoad)}
						<div class="flex flex-col items-center justify-center gap-2 p-4">
							<span class="text-sm text-muted-foreground"
								><T keyName="admin.support.thread.load_failed" /></span
							>
							<Button variant="outline" size="sm" onclick={attemptLoad}
								><T keyName="admin.support.thread.retry" /></Button
							>
						</div>
					{/snippet}

					{#snippet noData()}
						<!-- Empty - end of list reached -->
					{/snippet}
				</InfiniteLoader>
			</div>
		{:else}
			<div
				class="absolute inset-0 flex items-center justify-center p-8 text-center text-muted-foreground"
			>
				<T keyName={showingOpen ? 'admin.support.no_open_chats' : 'admin.support.no_done_chats'} />
			</div>
		{/if}
	</div>
</div>
