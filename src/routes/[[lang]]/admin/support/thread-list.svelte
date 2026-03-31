<script lang="ts">
	import { Input } from '$lib/components/ui/input';
	import * as Tabs from '$lib/components/ui/tabs';
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import { Skeleton } from '$lib/components/ui/skeleton';
	import AvatarHeading from '$lib/components/customer-support/avatar-heading.svelte';
	import SearchIcon from '@lucide/svelte/icons/search';
	import InboxIcon from '@lucide/svelte/icons/inbox';
	import ArchiveIcon from '@lucide/svelte/icons/archive';
	import Loader2Icon from '@lucide/svelte/icons/loader-2';
	import { formatDistanceToNow } from 'date-fns';
	import { type Locale, de, es, fr } from 'date-fns/locale';
	import { watch } from 'runed';
	import { haptic } from '$lib/hooks/use-haptic.svelte';
	import { T, getTranslate } from '@tolgee/svelte';
	import { InfiniteLoader, LoaderState } from 'svelte-infinite';
	import { page } from '$app/state';

	const dateFnsLocaleMap: Record<string, Locale> = { de, es, fr };
	const dateFnsLocale = $derived(dateFnsLocaleMap[page.data.lang] ?? undefined);

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

	// Reset loader when isDone transitions from true → false (new query started)
	watch(
		() => isDone,
		(curr, prev) => {
			if (prev && !curr) {
				loaderState.reset();
			}
		},
		{ lazy: true }
	);
</script>

<div class="flex h-full flex-col">
	<!-- Filters -->
	<div class="shrink-0 space-y-3 border-b p-4 dark:bg-background">
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
					? $t('admin.support.filter_showing_open')
					: $t('admin.support.filter_showing_completed')}
			>
				<InboxIcon
					class="size-4 transition-[transform,opacity,filter] duration-200 ease-out {showingOpen
						? 'blur-0 scale-100 opacity-100'
						: 'scale-75 opacity-0 blur-sm'}"
				/>
				<ArchiveIcon
					class="absolute size-4 transition-[transform,opacity,filter] duration-200 ease-out {showingOpen
						? 'scale-75 opacity-0 blur-sm'
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
					<div class="border-b p-4 dark:bg-muted/20">
						<div class="flex flex-col gap-2">
							<!-- AvatarHeading skeleton -->
							<div class="flex min-w-0 flex-1 items-center gap-2">
								<Skeleton class="size-8 shrink-0 rounded-full" />
								<div class="flex min-h-0 min-w-0 flex-col">
									<div class="flex h-5 items-center">
										<Skeleton class="h-4 w-48" />
									</div>
									<div class="flex h-[17.5px] items-center">
										<Skeleton class="h-3.5 w-32" />
									</div>
								</div>
							</div>

							<!-- Badges -->
							<div class="flex flex-wrap items-center gap-1.5 pl-10">
								<Skeleton class="h-5 w-10 rounded-4xl" />
								<Skeleton class="h-5 w-10 rounded-4xl" />
							</div>
						</div>
					</div>
				{/each}
			</div>
		{:else if threads && threads.length > 0}
			<!-- data-tolgee-restricted: thread previews may contain ZWNJ/ZWJ (tolgee/tolgee-js#3475) -->
			<div
				data-tolgee-restricted
				class="scrollbar-thin absolute inset-0 overflow-x-hidden overflow-y-auto"
			>
				<InfiniteLoader
					{loaderState}
					{triggerLoad}
					intersectionOptions={{ rootMargin: '0px 0px 200px 0px' }}
				>
					{#each threads as thread (thread._id)}
						<button
							class="w-full border-b p-4 text-left dark:bg-muted/20 {thread._id === selectedThreadId
								? 'bg-muted/70 dark:bg-muted/35'
								: 'hover:bg-muted/30 dark:hover:bg-muted/50'}"
							onclick={() => {
								if (thread._id !== selectedThreadId) {
									haptic.trigger('light');
									onThreadSelect(thread._id);
								}
							}}
						>
							<div class="flex flex-col gap-2">
								<AvatarHeading
									image={thread.userImage}
									title={thread.lastMessage || $t('admin.support.thread.no_messages')}
									subtitle={`${thread.userName || thread.userEmail || 'Anonymous'}\u00A0\u00A0·\u00A0\u00A0${formatDistanceToNow(new Date(thread.lastMessageAt || thread._creationTime), { locale: dateFnsLocale, addSuffix: true })}`}
									fallbackText={thread.userName}
									bold={false}
								/>

								<!-- Badges -->
								<div class="flex flex-wrap items-center gap-1.5 pl-10">
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
						</button>
					{/each}

					{#snippet loading()}
						<div class="flex items-center justify-center border-b p-4">
							<Loader2Icon class="size-5 text-muted-foreground motion-safe:animate-spin" />
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
