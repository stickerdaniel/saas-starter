<script lang="ts">
	import { useConvexClient, useQuery } from 'convex-svelte';
	import { api } from '$lib/convex/_generated/api';
	import { formatDistanceToNow } from 'date-fns';
	import ChatRoot from '$lib/chat/ui/ChatRoot.svelte';
	import ChatMessages from '$lib/chat/ui/ChatMessages.svelte';
	import ChatInput from '$lib/chat/ui/ChatInput.svelte';
	import { Button } from '$lib/components/ui/button';
	import PanelRightIcon from '@lucide/svelte/icons/panel-right';
	import PanelBottomOpen from '@lucide/svelte/icons/panel-bottom-open';
	import { useMedia } from '$lib/hooks/use-media.svelte';
	import { SlidingHeader } from '$lib/components/ui/sliding-header';
	import { T } from '@tolgee/svelte';
	import { adminSupportUI } from '$lib/hooks/admin-support-ui.svelte';

	let {
		threadId,
		initialThread,
		onBackClick
	}: {
		threadId: string;
		initialThread?: {
			userName?: string;
			userEmail?: string;
			lastMessageAt?: number;
		};
		onBackClick?: () => void;
	} = $props();

	const media = useMedia();
	const client = useConvexClient();

	// Query thread details to show header info
	const threadQuery = useQuery(api.admin.support.queries.getThreadForAdmin, () => ({
		threadId
	}));
	const thread = $derived(threadQuery.data);

	// Derived display values: prefer initialThread (instant), fallback to query data
	const displayName = $derived(
		initialThread?.userName ||
			initialThread?.userEmail ||
			thread?.user?.name ||
			thread?.user?.email ||
			'Anonymous User'
	);
	const lastMessageAt = $derived(
		initialThread?.lastMessageAt || thread?.supportMetadata?.updatedAt
	);

	// Mark as read when opened
	$effect(() => {
		if (threadId) {
			client.mutation(api.admin.support.mutations.markThreadAsRead, {
				threadId
			});
		}
	});
</script>

<div class="flex h-full flex-col">
	<!-- Mobile: Animated header with back button (<1024px) -->
	{#if !media.lg && onBackClick}
		<SlidingHeader
			isBackView={true}
			backTitle={displayName}
			backSubtitle={lastMessageAt
				? formatDistanceToNow(new Date(lastMessageAt), { addSuffix: true })
				: '\u00A0'}
			defaultTitle="Support Threads"
			{onBackClick}
			showClose={false}
		>
			{#snippet actions()}
				<Button variant="ghost" size="icon" onclick={() => adminSupportUI.toggle()} class="h-9 w-9">
					{#if media.sm}
						<PanelRightIcon class="h-5 w-5" />
					{:else}
						<PanelBottomOpen class="h-5 w-5" />
					{/if}
					<span class="sr-only">
						{adminSupportUI.detailsOpen ? 'Close details panel' : 'Open details panel'}
					</span>
				</Button>
			{/snippet}
		</SlidingHeader>
	{/if}

	<!-- Desktop: Standard header (≥1024px) -->
	{#if media.lg}
		<div class="flex-shrink-0 border-b p-4">
			<div class="flex items-center justify-between gap-4">
				<div class="min-w-0 flex-1 space-y-1">
					<h2 class="truncate font-semibold">
						{displayName}
					</h2>
					{#if thread?.title && thread.title !== 'Customer Support'}
						<p class="truncate text-sm text-muted-foreground">{thread.title}</p>
					{/if}
				</div>

				<!-- Toggle button for Sheet overlay (lg && !xl) -->
				{#if !media.xl}
					<Button
						variant="ghost"
						size="icon"
						onclick={() => adminSupportUI.toggle()}
						class="flex-shrink-0"
					>
						<PanelRightIcon class="size-4" />
						<span class="sr-only">
							{adminSupportUI.detailsOpen ? 'Close details panel' : 'Open details panel'}
						</span>
					</Button>
				{/if}
			</div>
		</div>
	{/if}

	<!-- Chat Messages -->
	<ChatRoot
		{threadId}
		userAlignment="left"
		api={{
			listMessages: api.support.messages.listMessages,
			sendMessage: api.admin.support.mutations.sendAdminReply
		}}
	>
		<div class="flex-1 overflow-hidden">
			<ChatMessages />
		</div>

		<ChatInput class="mx-4 -translate-y-4 p-0" placeholder="Reply to customer..." />
	</ChatRoot>
</div>
