<script lang="ts">
	import { useConvexClient, useQuery } from 'convex-svelte';
	import { api } from '$lib/convex/_generated/api';
	import { formatDistanceToNow } from 'date-fns';
	import ChatRoot from '$lib/chat/ui/ChatRoot.svelte';
	import ChatMessages from '$lib/chat/ui/ChatMessages.svelte';
	import ChatInput from '$lib/chat/ui/ChatInput.svelte';
	import { ChatUIContext, type UploadConfig } from '$lib/chat/ui/ChatContext.svelte';
	import { ChatCore } from '$lib/chat/core/ChatCore.svelte';
	import { Button } from '$lib/components/ui/button';
	import { Avatar, AvatarFallback, AvatarImage } from '$lib/components/ui/avatar';
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
			userImage?: string;
			lastMessageAt?: number;
		};
		onBackClick?: () => void;
	} = $props();

	const media = useMedia();
	const client = useConvexClient();

	// Upload configuration for file attachments
	const uploadConfig: UploadConfig = {
		generateUploadUrl: api.support.files.generateUploadUrl,
		saveUploadedFile: api.support.files.saveUploadedFile
	};

	// Create ChatCore for this thread (needed for ChatUIContext)
	const chatCore = new ChatCore({
		threadId,
		api: {
			sendMessage: api.admin.support.mutations.sendAdminReply
		}
	});

	// Create ChatUIContext with upload support (userAlignment 'left' for admin view)
	const chatUIContext = new ChatUIContext(chatCore, client, uploadConfig, 'left');

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
	const userEmail = $derived(initialThread?.userEmail || thread?.user?.email);
	const userImage = $derived(initialThread?.userImage || thread?.user?.image);
	const lastMessageAt = $derived(
		initialThread?.lastMessageAt || thread?.supportMetadata?.updatedAt
	);
</script>

<div class="flex h-full flex-col">
	<!-- Mobile: Animated header with back button (<1024px) -->
	{#if !media.lg && onBackClick}
		<SlidingHeader
			isBackView={true}
			backTitle={displayName}
			backSubtitle={userEmail || '\u00A0'}
			titleImage={userImage}
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
				<div class="flex min-w-0 flex-1 items-center gap-3">
					<Avatar class="size-8 shrink-0">
						{#if userImage}
							<AvatarImage src={userImage} alt={displayName} />
						{/if}
						<AvatarFallback>
							{displayName[0]?.toUpperCase() || 'U'}
						</AvatarFallback>
					</Avatar>
					<div class="min-w-0 flex-1">
						<h2 class="truncate font-semibold">
							{displayName}
						</h2>
						{#if userEmail}
							<p class="truncate text-sm text-muted-foreground">{userEmail}</p>
						{/if}
					</div>
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
		externalUIContext={chatUIContext}
		api={{
			listMessages: api.support.messages.listMessages,
			sendMessage: api.admin.support.mutations.sendAdminReply
		}}
	>
		<div class="flex-1 overflow-hidden">
			<ChatMessages />
		</div>

		<ChatInput
			class="mx-4 -translate-y-4 p-0"
			placeholder="Reply to customer..."
			showFileButton={true}
			onSend={async (prompt) => {
				if (!prompt) return;

				// Get uploaded file IDs from context
				const fileIds = chatUIContext.uploadedFileIds;

				try {
					await client.mutation(api.admin.support.mutations.sendAdminReply, {
						threadId,
						prompt,
						fileIds: fileIds.length > 0 ? fileIds : undefined
					});

					// Clear attachments after successful send
					chatUIContext.clearAttachments();
				} catch (error) {
					console.error('[Admin sendAdminReply] Error:', error);
				}
			}}
		/>
	</ChatRoot>
</div>
