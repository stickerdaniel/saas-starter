<script lang="ts">
	import { useQuery } from 'convex-svelte';
	import { api } from '$lib/convex/_generated/api';
	import { Button } from '$lib/components/ui/button';
	import { Avatar, AvatarImage } from '$lib/components/ui/avatar';
	import { Bot, ChevronRight, Send } from '@lucide/svelte';
	import { supportThreadContext } from './support-thread-context.svelte';
	import NavigationButton from './navigation-button.svelte';
	import AvatarHeading from './avatar-heading.svelte';
	import { FadeOnLoad } from '$lib/utils/fade-on-load.svelte.js';
	import memberFour from '$blocks/team/avatars/member-four.webp';
	import memberTwo from '$blocks/team/avatars/member-two.webp';
	import memberFive from '$blocks/team/avatars/member-five.webp';

	let {
		onClose
	}: {
		onClose: () => void;
	} = $props();

	const ctx = supportThreadContext.get();

	// Reactive query for threads - auto-updates when new threads are created
	const threadsQuery = $derived(
		ctx.userId
			? useQuery(api.support.threads.listThreads, {
					userId: ctx.userId,
					paginationOpts: { numItems: 20, cursor: null }
				})
			: undefined
	);

	const threads = $derived(threadsQuery?.data?.page ?? []);
	const isLoading = $derived(threadsQuery?.isLoading ?? !ctx.userId);

	// Fade animation state - triggers only on first successful load
	const threadsFade = new FadeOnLoad();

	// Track first load to trigger fade animation (one-time side effect)
	$effect(() => {
		if (!isLoading && !threadsFade.hasLoadedOnce) {
			threadsFade.markLoaded();
		}
	});

	/**
	 * Format a timestamp as relative time (e.g., "a few seconds ago", "3 minutes ago")
	 */
	function formatRelativeTime(timestamp?: number): string {
		if (!timestamp) return '';

		const now = Date.now();
		const diff = now - timestamp;
		const seconds = Math.floor(diff / 1000);
		const minutes = Math.floor(seconds / 60);
		const hours = Math.floor(minutes / 60);
		const days = Math.floor(hours / 24);

		if (seconds < 10) return 'just now';
		if (seconds < 60) return 'a few seconds ago';
		if (minutes === 1) return '1 minute ago';
		if (minutes < 60) return `${minutes} minutes ago`;
		if (hours === 1) return '1 hour ago';
		if (hours < 24) return `${hours} hours ago`;
		if (days === 1) return 'yesterday';
		if (days < 7) return `${days} days ago`;

		return new Date(timestamp).toLocaleDateString();
	}
</script>

<div class="flex h-full flex-col">
	<!-- Header -->
	<header
		class="flex shrink-0 items-center justify-between border-b border-border/50 bg-secondary p-4"
	>
		<div class="flex h-10 flex-1 items-center justify-center">
			<h2 class="text-xl font-semibold">Messages</h2>
		</div>
		<NavigationButton type="close" onclick={onClose} class="absolute right-4" />
	</header>

	<!-- Thread List -->
	<div class="min-h-0 flex-1 overflow-y-auto">
		{#if !isLoading && threads.length === 0}
			<!-- Empty state with greeting (only shown after query completes) -->
			<div class="flex h-full flex-col justify-start {threadsFade.animationClass}">
				<div class="m-10 flex flex-col items-start">
					<!-- Avatar stack -->
					<div class="mb-6 flex -space-x-3">
						<Avatar class="size-12 outline outline-4 outline-secondary">
							<AvatarImage src={memberFour} alt="Team member" class="object-cover" />
						</Avatar>
						<Avatar class="size-12 outline outline-4 outline-secondary">
							<AvatarImage src={memberTwo} alt="Team member" class="object-cover" />
						</Avatar>
						<Avatar class="size-12 outline outline-4 outline-secondary">
							<AvatarImage src={memberFive} alt="Team member" class="object-cover" />
						</Avatar>
					</div>

					<!-- Greeting -->
					<h2 class="mb-4 text-5xl font-semibold text-muted-foreground">Hi 👋</h2>

					<!-- Main heading -->
					<h3 class="text-3xl font-bold">How can we help you today?</h3>
				</div>
			</div>
		{:else}
			<!-- Thread list with fade-in animation on first load -->
			<div class={threadsFade.animationClass}>
				{#each threads as thread (thread._id)}
					<button
						class="flex w-full items-center gap-3 border-b border-border/30 p-4 px-7 text-left transition-colors hover:bg-muted-foreground/10"
						onclick={() => ctx.selectThread(thread._id, thread.lastAgentName)}
					>
						<AvatarHeading
							icon={Bot}
							title={thread.lastMessage || thread.summary || 'New conversation'}
							subtitle={`${thread.lastAgentName || 'Kai'}\u00A0\u00A0·\u00A0\u00A0${formatRelativeTime(thread.lastMessageAt)}`}
							bold={false}
						/>

						<!-- Chevron -->
						<ChevronRight class="size-5 shrink-0 text-muted-foreground" />
					</button>
				{/each}
			</div>
		{/if}
	</div>

	<!-- New Message Button -->
	<div class="shrink-0 border-t border-border/50 bg-secondary p-4">
		<Button class=" w-full rounded-full" onclick={() => ctx.startNewThread()} size="lg">
			<Send />
			Start a new conversation
		</Button>
	</div>
</div>
