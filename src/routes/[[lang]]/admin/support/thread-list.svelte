<script lang="ts">
	import { mergeProps } from 'bits-ui';
	import { Input } from '$lib/components/ui/input';
	import * as Tabs from '$lib/components/ui/tabs';
	import * as Tooltip from '$lib/components/ui/tooltip';
	import { Button } from '$lib/components/ui/button';
	import AdminThreadRow from '$lib/components/ui/owned/admin-thread-row.svelte';
	import { Badge, type BadgeVariant } from '$lib/components/ui/badge';
	import { Skeleton } from '$lib/components/ui/skeleton';
	import AvatarHeading from '$lib/components/customer-support/avatar-heading.svelte';
	import SearchIcon from '@lucide/svelte/icons/search';
	import InboxIcon from '@lucide/svelte/icons/inbox';
	import ArchiveIcon from '@lucide/svelte/icons/archive';
	import IconSwap from '$lib/components/motion/icon-swap.svelte';
	import Loader2Icon from '@lucide/svelte/icons/loader-2';
	import { formatDistanceToNow } from 'date-fns';
	import { untrack } from 'svelte';
	import { watch } from 'runed';
	import type { PaginationStatus } from 'convex/browser';
	import { haptic } from '$lib/hooks/use-haptic.svelte.ts';
	import { T, getTranslate } from '@tolgee/svelte';
	import { InfiniteLoader, LoaderState } from 'svelte-infinite';
	import { page } from '$app/state';
	import { getDateFnsLocale } from '$lib/utils/i18n';

	const dateFnsLocale = $derived(getDateFnsLocale(page.data.lang));

	const { t } = getTranslate();

	type FilterMode = 'all' | 'unassigned' | 'my-inbox';

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

	const PRIORITY_VARIANTS: Record<
		NonNullable<Thread['supportMetadata']['priority']>,
		BadgeVariant
	> = {
		low: 'bordered-success',
		medium: 'bordered-warning',
		high: 'bordered-destructive'
	};

	const PRIORITY_LABEL_KEYS = {
		low: 'admin.support.priority.low',
		medium: 'admin.support.priority.medium',
		high: 'admin.support.priority.high'
	} as const satisfies Record<NonNullable<Thread['supportMetadata']['priority']>, string>;

	const STATUS_LABEL_KEYS = {
		open: 'admin.support.status.open',
		done: 'admin.support.status.done'
	} as const satisfies Record<Thread['supportMetadata']['status'], string>;

	let {
		filterMode,
		statusFilter,
		searchQuery,
		threads = [],
		selectedThreadId,
		status,
		isLoading,
		error,
		queryIdentity,
		cachedCount,
		onFilterChange,
		onStatusChange,
		onSearchChange,
		onThreadSelect,
		onLoadMore
	}: {
		filterMode: FilterMode;
		statusFilter: 'open' | 'done';
		searchQuery: string;
		threads?: Thread[];
		selectedThreadId: string | null | undefined;
		/** The paginated query's own status, which it keeps while a changed query loads. */
		status: PaginationStatus;
		/** True from the moment the query's arguments change until their first answer. */
		isLoading: boolean;
		error?: Error | undefined;
		/** Changes exactly when the arguments of the paginated query change. */
		queryIdentity: string;
		cachedCount?: number;
		onFilterChange: (mode: FilterMode) => void;
		onStatusChange: (status: 'open' | 'done') => void;
		onSearchChange: (query: string) => void;
		onThreadSelect: (id: string) => void;
		onLoadMore: (numItems: number) => boolean;
	} = $props();

	// Bits UI drops touch pointers in its hover handlers, so the truncated filter
	// labels are unreachable on a phone. Drive the tooltips from one open mode
	// instead: hover, focus and outside dismissal keep writing through the
	// binding, and a tap re-opens the tooltip that the trigger's own click
	// handler closes.
	let openLabel = $state<FilterMode | null>(null);
	let tapPointerType: string | null = null;
	let isPointerDown = false;

	// A tooltip that repeats a fully visible label is noise, so every segment
	// reports whether it actually clips its text and only a clipped one may open.
	// The gate lives in the open state rather than in the tooltip's `disabled`
	// prop, because that prop puts `data-disabled` on the shared button and Bits
	// UI's roving focus skips every tab carrying it.
	let clippedLabels = $state<Record<FilterMode, boolean>>({
		'my-inbox': false,
		all: false,
		unassigned: false
	});

	function trackLabelClip(mode: FilterMode) {
		return (node: HTMLElement) => {
			let disposed = false;

			const measure = () => {
				if (disposed) return;
				// Both widths are rounded, so ignore a single pixel of difference
				// instead of promising an ellipsis nobody can see.
				const clipped = node.scrollWidth - node.clientWidth > 1;
				clippedLabels[mode] = clipped;
				if (!clipped && openLabel === mode) openLabel = null;
			};

			measure();
			// A fallback font measures differently than the loaded one.
			node.ownerDocument.fonts?.ready.then(measure);

			// The segment resizes with the pane, while the label itself changes with
			// the locale without resizing its clamped span.
			const resizeObserver = new ResizeObserver(measure);
			resizeObserver.observe(node);
			const textObserver = new MutationObserver(measure);
			textObserver.observe(node, { characterData: true, childList: true, subtree: true });

			return () => {
				disposed = true;
				resizeObserver.disconnect();
				textObserver.disconnect();
			};
		};
	}

	function setLabelOpen(mode: FilterMode, open: boolean) {
		if (open) {
			if (clippedLabels[mode]) openLabel = mode;
		} else if (openLabel === mode) {
			openLabel = null;
		}
	}

	function labelTapProps(mode: FilterMode) {
		return {
			onpointerdown: (event: PointerEvent) => {
				tapPointerType = event.pointerType;
				isPointerDown = true;
			},
			onpointerup: () => {
				isPointerDown = false;
			},
			// A canceled touch never reaches pointerup, so Bits UI keeps its own
			// pointer-down flag raised and drops every focus that follows. Clear the
			// local tap state here and let the focus handler below open the tooltip.
			onpointercancel: () => {
				tapPointerType = null;
				isPointerDown = false;
			},
			// Guarded by the pointer state so a press still reveals the tooltip on its
			// own click instead of flashing it on the focus that precedes the click.
			onfocus: () => {
				if (!isPointerDown && clippedLabels[mode]) openLabel = mode;
			},
			onclick: () => {
				const wasTap = tapPointerType === 'touch';
				tapPointerType = null;
				isPointerDown = false;
				if (wasTap && clippedLabels[mode]) openLabel = mode;
			}
		};
	}

	// Skeleton count: use cached count or default to 6
	const skeletonCount = $derived(cachedCount ?? 6);

	// Derived state for toggle (true = showing open, false = showing done)
	let showingOpen = $derived(statusFilter === 'open');

	function toggleFilter() {
		onStatusChange(showingOpen ? 'done' : 'open');
	}

	// A page is on its way, or a changed query has not answered yet. While its
	// arguments change the query keeps its previous status, including Exhausted,
	// so only the loading flag tells that status apart from the current query's.
	const isBusy = $derived(isLoading || status === 'LoadingFirstPage' || status === 'LoadingMore');
	const isExhausted = $derived(!isLoading && status === 'Exhausted');
	const canRequest = $derived(!error && !isLoading && status === 'CanLoadMore');

	// What the list shows, read from the query alone so that a failure appears
	// whether or not a load attempt is waiting for it. Rows stay on screen while
	// more load and while a changed query resolves; skeletons only fill an empty
	// list.
	const view = $derived.by(() => {
		if (error && threads.length === 0) return 'initial-error';
		if (threads.length > 0) return 'list';
		if (isBusy) return 'waiting';
		if (isExhausted) return 'empty';
		return 'list';
	});

	// The bridge between svelte-infinite and the paginated query.
	//
	// InfiniteLoader marks the loader LOADING, awaits triggerLoad, then returns a
	// still-LOADING loader to READY in its own continuation. Each attempt
	// therefore resolves only once the query has answered it, and every write to
	// the loader waits until that continuation has run, so an attempt from an
	// earlier query can never return a newer attempt to READY.
	//
	// The loader only observes its sentinel when it mounts or its observer
	// options change, and reset() or READY alone do not make a still-visible
	// sentinel load. Whenever loading becomes possible again, a new options
	// object makes it observe once more without remounting the rows.
	const LOAD_MORE_COUNT = 25;
	const ROOT_MARGIN = '0px 0px 200px 0px';
	// The library's own defaults, stated because the cooling wake-up below
	// depends on them.
	const LOOP_MAX_CALLS = 5;
	const LOOP_DETECTION_TIMEOUT = 2000;
	const LOOP_TIMEOUT = 3000;

	const loaderState = new LoaderState();
	let intersectionOptions = $state<IntersectionObserverInit>({ rootMargin: ROOT_MARGIN });

	// Loader writes held until no attempt is in flight.
	let pendingReset = $state(false);
	let pendingComplete = $state(false);
	let pendingRearm = $state(false);

	interface Attempt {
		identity: string;
		/** The rows and status before this attempt asked for a page; null when it only waits. */
		before: { threads: Thread[]; status: PaginationStatus } | null;
		resolve: () => void;
	}

	let attempt: Attempt | null = null;
	// The last re-observation has not produced a trigger yet, which is what
	// happens when it arrives while the loader is cooling down.
	let rearmUnanswered = false;
	let destroyed = false;

	function releaseAttempt() {
		const current = attempt;
		attempt = null;
		current?.resolve();
	}

	function settleAttempt() {
		if (!attempt) return;
		if (attempt.identity !== queryIdentity) {
			releaseAttempt();
			return;
		}
		if (error) {
			pendingRearm = true;
			releaseAttempt();
			return;
		}
		if (isBusy) return;
		const { before } = attempt;
		if (before && threads === before.threads && status === before.status) return;
		if (isExhausted) pendingComplete = true;
		else pendingRearm = true;
		releaseAttempt();
	}

	function triggerLoad(): Promise<void> {
		rearmUnanswered = false;
		if (error) {
			pendingRearm = true;
			return Promise.resolve();
		}
		if (isExhausted) {
			pendingComplete = true;
			return Promise.resolve();
		}
		let before: Attempt['before'] = null;
		if (canRequest) {
			before = { threads, status };
			// false means a page is already on its way, which this attempt waits for.
			onLoadMore(LOAD_MORE_COUNT);
		}
		return new Promise((resolve) => {
			attempt = { identity: queryIdentity, before, resolve };
			// A page that was already available has arrived by now.
			settleAttempt();
		});
	}

	// Every change of the query can be the outcome an attempt waits for.
	$effect(() => {
		void [threads, status, isLoading, error, queryIdentity];
		untrack(settleAttempt);
	});

	// A changed query starts a new generation: the old attempt is released and
	// the loader is reset and re-armed once that attempt has fully finished.
	watch(
		() => queryIdentity,
		() => {
			releaseAttempt();
			rearmUnanswered = false;
			pendingComplete = false;
			pendingReset = true;
			pendingRearm = true;
		},
		{ lazy: true }
	);

	// Applies the held writes once InfiniteLoader's continuation has run. A
	// re-observation also waits until the current query can take a request.
	$effect(() => {
		if (loaderState.status === 'LOADING') return;
		if (pendingReset) {
			pendingReset = false;
			loaderState.reset();
		}
		if (pendingComplete) {
			pendingComplete = false;
			loaderState.complete();
		}
		if (pendingRearm && canRequest && loaderState.status === 'READY') {
			pendingRearm = false;
			rearmUnanswered = true;
			intersectionOptions = { rootMargin: ROOT_MARGIN };
		}
	});

	// InfiniteLoader drops observations while it cools down after too many loads
	// in a row, and does not observe again when the cooldown ends. Its cooling
	// snippet is the only signal of that end: when it goes away and the last
	// re-observation was dropped, observe once more.
	function wakeAfterCooling() {
		return () => {
			if (!destroyed && rearmUnanswered) pendingRearm = true;
		};
	}

	$effect(() => () => {
		destroyed = true;
		releaseAttempt();
	});
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
					adornment="leading-icon"
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
				<IconSwap showSecond={!showingOpen} class="size-4">
					{#snippet first()}
						<InboxIcon class="size-4" />
					{/snippet}
					{#snippet second()}
						<ArchiveIcon class="size-4" />
					{/snippet}
				</IconSwap>
			</Button>
		</div>

		<!-- Filter Tabs -->
		<Tabs.Root value={filterMode} onValueChange={(v) => onFilterChange(v as FilterMode)}>
			<Tabs.List class="w-full">
				<Tooltip.Root
					delayDuration={400}
					bind:open={() => openLabel === 'my-inbox', (open) => setLabelOpen('my-inbox', open)}
				>
					<Tooltip.Trigger>
						{#snippet child({ props })}
							<!-- The tooltip trigger props carry data-slot="tooltip-trigger"; restate the
								 tabs slot after them so tabs-list.svelte still finds the active trigger.
								 They also carry an empty aria-describedby, because Bits UI strips the id
								 from the rendered tooltip content. Drop the dangling reference and hide
								 the content: each tab already exposes its full label. -->
							<Tabs.Trigger
								{...mergeProps(props, labelTapProps('my-inbox'))}
								data-slot="tabs-trigger"
								aria-describedby={undefined}
								value="my-inbox"
								size="compact"
							>
								<span class="min-w-0 truncate" {@attach trackLabelClip('my-inbox')}
									><T keyName="admin.support.filter.my_inbox" /></span
								>
							</Tabs.Trigger>
						{/snippet}
					</Tooltip.Trigger>
					<Tooltip.Content side="bottom" aria-hidden="true"
						>{$t('admin.support.filter.my_inbox')}</Tooltip.Content
					>
				</Tooltip.Root>
				<Tooltip.Root
					delayDuration={400}
					bind:open={() => openLabel === 'all', (open) => setLabelOpen('all', open)}
				>
					<Tooltip.Trigger>
						{#snippet child({ props })}
							<Tabs.Trigger
								{...mergeProps(props, labelTapProps('all'))}
								data-slot="tabs-trigger"
								aria-describedby={undefined}
								value="all"
								size="compact"
							>
								<span class="min-w-0 truncate" {@attach trackLabelClip('all')}
									><T keyName="admin.support.filter.all" /></span
								>
							</Tabs.Trigger>
						{/snippet}
					</Tooltip.Trigger>
					<Tooltip.Content side="bottom" aria-hidden="true"
						>{$t('admin.support.filter.all')}</Tooltip.Content
					>
				</Tooltip.Root>
				<Tooltip.Root
					delayDuration={400}
					bind:open={() => openLabel === 'unassigned', (open) => setLabelOpen('unassigned', open)}
				>
					<Tooltip.Trigger>
						{#snippet child({ props })}
							<Tabs.Trigger
								{...mergeProps(props, labelTapProps('unassigned'))}
								data-slot="tabs-trigger"
								aria-describedby={undefined}
								value="unassigned"
								size="compact"
							>
								<span class="min-w-0 truncate" {@attach trackLabelClip('unassigned')}
									><T keyName="admin.support.filter.unassigned" /></span
								>
							</Tabs.Trigger>
						{/snippet}
					</Tooltip.Trigger>
					<Tooltip.Content side="bottom" aria-hidden="true"
						>{$t('admin.support.filter.unassigned')}</Tooltip.Content
					>
				</Tooltip.Root>
			</Tabs.List>
		</Tabs.Root>
	</div>

	<!-- Thread List -->
	<div class="relative flex-1">
		{#if view === 'initial-error'}
			<!-- Query error with nothing loaded; a failure with rows on screen is reported below them -->
			<div
				class="absolute inset-0 flex items-center justify-center p-8 text-center text-destructive"
				data-testid="admin-support-threads-error"
			>
				<T keyName="common.load_error" />
			</div>
		{:else if view === 'waiting'}
			<!-- Loading skeletons -->
			<div class="absolute inset-0 scrollbar-thin overflow-y-auto">
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
		{:else if view === 'list'}
			<!-- data-tolgee-restricted: thread previews may contain ZWNJ/ZWJ (tolgee/tolgee-js#3475) -->
			<div
				data-tolgee-restricted
				class="absolute inset-0 scrollbar-thin overflow-x-hidden overflow-y-auto"
			>
				<InfiniteLoader
					{loaderState}
					{triggerLoad}
					{intersectionOptions}
					loopMaxCalls={LOOP_MAX_CALLS}
					loopDetectionTimeout={LOOP_DETECTION_TIMEOUT}
					loopTimeout={LOOP_TIMEOUT}
				>
					{#each threads as thread (thread._id)}
						<AdminThreadRow
							type="button"
							selected={thread._id === selectedThreadId}
							onclick={() => {
								if (thread._id !== selectedThreadId) {
									haptic.trigger('light');
									onThreadSelect(thread._id);
								}
							}}
						>
							<!-- Bounded to the row, so a long message ends in an ellipsis instead of under the pane edge -->
							<div class="flex w-full min-w-0 flex-col gap-2">
								<AvatarHeading
									image={thread.userImage}
									title={thread.lastMessage || $t('admin.support.thread.no_messages')}
									subtitle={`${thread.userName || thread.userEmail || $t('admin.support.anonymous')}\u00A0\u00A0·\u00A0\u00A0${formatDistanceToNow(new Date(thread.lastMessageAt || thread._creationTime), { locale: dateFnsLocale, addSuffix: true })}`}
									fallbackText={thread.userName}
									bold={false}
								/>

								<!-- Badges -->
								<div class="flex flex-wrap items-center gap-1.5 pl-10">
									{#if thread.supportMetadata.awaitingAdminResponse}
										<Badge variant="default"><T keyName="admin.support.thread.badge.new" /></Badge>
									{/if}
									{#if thread.supportMetadata.priority}
										<Badge variant={PRIORITY_VARIANTS[thread.supportMetadata.priority]}>
											{$t(PRIORITY_LABEL_KEYS[thread.supportMetadata.priority])}
										</Badge>
									{/if}
									{#if thread.supportMetadata.status}
										<Badge variant="secondary">
											{$t(STATUS_LABEL_KEYS[thread.supportMetadata.status])}
										</Badge>
									{/if}
								</div>
							</div>
						</AdminThreadRow>
					{/each}

					<!-- The region outlives every message it carries: a status container
					     that appears already holding its text is not reliably read out, and
					     the failure can arrive in any pagination status, including after the
					     last page. It stays empty, and so invisible, while nothing failed.
					     It offers no retry, because the query has none; the list loads on
					     by itself once the subscription recovers. -->
					<div role="status">
						{#if error}
							<p class="p-4 text-center text-sm text-balance text-destructive">
								{$t('admin.support.thread.load_failed')}
							</p>
						{/if}
					</div>

					{#snippet loading()}
						<div class="flex items-center justify-center border-b p-4">
							<Loader2Icon class="size-5 text-muted-foreground motion-safe:animate-spin" />
							<span class="ml-2 text-sm text-muted-foreground"
								><T keyName="admin.support.thread.loading" /></span
							>
						</div>
					{/snippet}

					<!-- Every other loader state has a snippet: the library's fallbacks render
					     English copy and a retry button that would bypass the bridge. -->
					{#snippet error()}{/snippet}
					{#snippet noResults()}{/snippet}
					{#snippet noData()}{/snippet}
					{#snippet coolingOff()}
						<span hidden {@attach wakeAfterCooling}></span>
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
