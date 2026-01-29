<script lang="ts">
	import { useConvexClient, useQuery } from 'convex-svelte';
	import { toast } from 'svelte-sonner';
	import { api } from '$lib/convex/_generated/api';
	import ChatRoot from '$lib/chat/ui/ChatRoot.svelte';
	import ChatMessages from '$lib/chat/ui/ChatMessages.svelte';
	import ChatInput from '$lib/chat/ui/ChatInput.svelte';
	import { ChatUIContext, type UploadConfig } from '$lib/chat/ui/ChatContext.svelte';
	import { ChatCore } from '$lib/chat/core/ChatCore.svelte';
	import { createOptimisticUpdate, type ListMessagesArgs } from '$lib/chat/core/optimistic';
	import { Button } from '$lib/components/ui/button';
	import { Avatar, AvatarFallback, AvatarImage } from '$lib/components/ui/avatar';
	import { Skeleton } from '$lib/components/ui/skeleton';
	import PanelRightIcon from '@lucide/svelte/icons/panel-right';
	import PanelBottomOpen from '@lucide/svelte/icons/panel-bottom-open';
	import ChevronLeft from '@lucide/svelte/icons/chevron-left';
	import { useMedia } from '$lib/hooks/use-media.svelte';
	import { SlidingHeader } from '$lib/components/ui/sliding-header';
	import { adminSupportUI } from '$lib/hooks/admin-support-ui.svelte';
	import { getTranslate } from '@tolgee/svelte';
	import { page } from '$app/state';

	const { t } = getTranslate();

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

	// Upload configuration for file attachments with locale for translated error messages
	const uploadConfig: UploadConfig = {
		generateUploadUrl: api.support.files.generateUploadUrl,
		saveUploadedFile: api.support.files.saveUploadedFile,
		locale: page.data.lang
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

	// Loading state: true when no initial data and query hasn't resolved yet
	const isLoading = $derived(!initialThread && !thread);

	// Derived display values: prefer initialThread (instant), fallback to query data
	const displayName = $derived(
		initialThread?.userName ||
			initialThread?.userEmail ||
			thread?.user?.name ||
			thread?.user?.email ||
			'Anonymous'
	);
	const userEmail = $derived(initialThread?.userEmail || thread?.user?.email);
	const userImage = $derived(initialThread?.userImage || thread?.user?.image);

	// Display email: user email, or notification email for anonymous users, or "No email"
	const displayEmail = $derived(
		userEmail || thread?.supportMetadata?.notificationEmail || 'No email'
	);
</script>

<div class="flex h-full flex-col">
	<!-- Mobile: Animated header with back button (<1024px) -->
	{#if !media.lg && onBackClick}
		{#if isLoading}
			<!-- Skeleton header while loading (with functional buttons) -->
			<header class="flex shrink-0 items-center gap-2 border-b border-border/50 p-4">
				<!-- Back button (functional) -->
				<div class="relative flex size-10 items-center justify-center">
					<Button
						variant="ghost"
						size="icon"
						class="h-10 w-10 rounded-full hover:!bg-muted-foreground/10"
						onclick={onBackClick}
					>
						<ChevronLeft class="size-5" />
					</Button>
				</div>
				<!-- Avatar + text skeleton container (matches SlidingHeader's py-1 + h-10 structure) -->
				<div class="min-w-0 flex-1 py-1">
					<div class="flex h-10 items-center gap-2">
						<Skeleton class="size-8 shrink-0 rounded-full" />
						<div class="flex min-w-0 flex-col justify-center gap-1">
							<Skeleton class="h-4 w-28" />
							<Skeleton class="h-3 w-40" />
						</div>
					</div>
				</div>
				<!-- Details panel toggle (functional) -->
				<Button variant="ghost" size="icon" onclick={() => adminSupportUI.toggle()} class="h-9 w-9">
					{#if media.sm}
						<PanelRightIcon class="h-5 w-5" />
					{:else}
						<PanelBottomOpen class="h-5 w-5" />
					{/if}
					<span class="sr-only">
						{adminSupportUI.detailsOpen
							? $t('admin.support.details.close_panel')
							: $t('admin.support.details.open_panel')}
					</span>
				</Button>
			</header>
		{:else}
			<SlidingHeader
				isBackView={true}
				backTitle={displayName}
				backSubtitle={displayEmail}
				titleImage={userImage}
				defaultTitle="Support Threads"
				{onBackClick}
				showClose={false}
			>
				{#snippet actions()}
					<Button
						variant="ghost"
						size="icon"
						onclick={() => adminSupportUI.toggle()}
						class="h-9 w-9"
					>
						{#if media.sm}
							<PanelRightIcon class="h-5 w-5" />
						{:else}
							<PanelBottomOpen class="h-5 w-5" />
						{/if}
						<span class="sr-only">
							{adminSupportUI.detailsOpen
								? $t('admin.support.details.close_panel')
								: $t('admin.support.details.open_panel')}
						</span>
					</Button>
				{/snippet}
			</SlidingHeader>
		{/if}
	{/if}

	<!-- Desktop: Standard header (≥1024px) -->
	{#if media.lg}
		<div class="flex-shrink-0 border-b p-4">
			<div class="flex items-center justify-between gap-4">
				<div class="flex min-w-0 flex-1 items-center gap-3">
					{#if isLoading}
						<!-- Skeleton state (matches resolved text layout) -->
						<Skeleton class="size-8 shrink-0 rounded-full" />
						<div class="min-w-0 flex-1">
							<div class="flex h-6 items-center">
								<Skeleton class="h-4 w-28" />
							</div>
							<div class="flex h-5 items-center">
								<Skeleton class="h-3.5 w-40" />
							</div>
						</div>
					{:else}
						<!-- Resolved state -->
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
							<p class="truncate text-sm text-muted-foreground">{displayEmail}</p>
						</div>
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
							{adminSupportUI.detailsOpen
								? $t('admin.support.details.close_panel')
								: $t('admin.support.details.open_panel')}
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
			placeholder={$t('admin.support.chat.placeholder')}
			showFileButton={true}
			onSend={async (prompt) => {
				if (!prompt) return;

				// Get uploaded file IDs from context
				const fileIds = chatUIContext.uploadedFileIds;

				// Build query args for optimistic update (must match ChatRoot's query)
				const queryArgs: ListMessagesArgs = {
					threadId,
					paginationOpts: { numItems: 50, cursor: null },
					streamArgs: { kind: 'list' as const, startOrder: 0 }
				};

				try {
					await client.mutation(
						api.admin.support.mutations.sendAdminReply,
						{
							threadId,
							prompt,
							fileIds: fileIds.length > 0 ? fileIds : undefined
						},
						{
							optimisticUpdate: createOptimisticUpdate(
								api.support.messages.listMessages,
								queryArgs,
								'assistant',
								prompt,
								{ metadata: { provider: 'human' } }
							)
						}
					);

					// Clear attachments after successful send
					chatUIContext.clearAttachments();
				} catch (error) {
					console.error('[Admin sendAdminReply] Error:', error);
					toast.error('Failed to send reply. Please try again.');
					// Optimistic update automatically rolled back by Convex
				}
			}}
		/>
	</ChatRoot>
</div>
