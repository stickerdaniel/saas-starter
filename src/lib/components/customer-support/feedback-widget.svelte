<script lang="ts">
	import { useConvexClient, useQuery } from 'convex-svelte';
	import { page } from '$app/state';
	import { api } from '$lib/convex/_generated/api';
	import { supportThreadContext } from './support-thread-context.svelte';
	import { lockscroll } from '@svelte-put/lockscroll';
	import { IsMobile } from '$lib/hooks/is-mobile.svelte.js';

	// Import new chat components
	import { ChatRoot, ChatMessages, ChatInput, type ChatUIContext } from '$lib/chat';
	import type { Attachment, DisplayMessage } from '$lib/chat';

	// Import thread navigation components
	import ThreadsOverview from './threads-overview.svelte';
	import { Bot, MessagesSquare, UsersRound } from '@lucide/svelte';
	import { SlidingPanel } from '$lib/components/ui/sliding-panel';
	import { SlidingHeader } from '$lib/components/ui/sliding-header';

	let {
		isScreenshotMode = $bindable(false),
		chatUIContext,
		onClose
	}: {
		isScreenshotMode?: boolean;
		chatUIContext: ChatUIContext;
		onClose?: () => void;
	} = $props();

	// Get thread context
	const threadContext = supportThreadContext.get();

	// Derive agent name from context with fallback
	let agentName = $derived(threadContext.currentAgentName || 'Kai');

	// Derive chat panel open state
	const isChatOpen = $derived(threadContext.currentView !== 'overview');

	// Get Convex client
	const client = useConvexClient();

	// Query thread status (for handoff state)
	const threadQuery = useQuery(api.support.threads.getThread, () =>
		threadContext.threadId
			? { threadId: threadContext.threadId, userId: threadContext.userId || undefined }
			: 'skip'
	);

	// Derive assigned admin - use context value as primary, query as fallback/sync
	const assignedAdmin = $derived(threadContext.assignedAdmin ?? threadQuery.data?.assignedAdmin);

	// Sync handoff status and assigned admin to context when thread data loads
	// Only sync from query if not already set locally (prevents race conditions)
	$effect(() => {
		if (threadQuery.data) {
			// Sync handoff status if not already handed off locally
			if (!threadContext.isHandedOff && threadQuery.data.isHandedOff) {
				threadContext.setHandedOff(threadQuery.data.isHandedOff);
			}
			// Sync assignedAdmin if query has newer data (e.g., admin assigned mid-chat)
			if (threadQuery.data.assignedAdmin && !threadContext.assignedAdmin) {
				threadContext.assignedAdmin = threadQuery.data.assignedAdmin;
			}
		}
	});

	// Handle handoff request
	async function handleRequestHandoff() {
		const success = await threadContext.requestHandoff(client);
		if (success) {
			// Optionally show a toast or feedback
			console.log('[handleRequestHandoff] Successfully handed off to human support');
		}
	}

	// Handle email notification submission
	async function handleSubmitEmail(email: string) {
		const success = await threadContext.setNotificationEmail(client, email);
		if (!success) {
			throw new Error('Failed to save email');
		}
	}

	const isMobile = new IsMobile();

	// API configuration for ChatRoot
	const chatApi = {
		sendMessage: api.support.messages.sendMessage,
		listMessages: api.support.messages.listMessages
	};

	function handleScreenshot() {
		isScreenshotMode = true;
	}

	// Extract attachments from message content
	function extractAttachments(msg: DisplayMessage): Attachment[] {
		// 1. Optimistic attachments
		if (msg.localAttachments && msg.localAttachments.length > 0) {
			return msg.localAttachments;
		}

		const attachments: Attachment[] = [];

		// 2. Real message content
		const content = msg.parts || msg.message?.content;

		if (Array.isArray(content)) {
			for (const part of content) {
				if (part.type === 'file') {
					const url = part.url || (typeof part.data === 'string' ? part.data : null);

					if (url) {
						const isImage =
							part.mediaType?.startsWith('image/') || part.mimeType?.startsWith('image/');

						if (isImage) {
							attachments.push({
								type: 'image',
								url: url,
								filename: part.filename || 'Image'
							});
						} else {
							attachments.push({
								type: 'remote-file',
								url: url,
								filename: part.filename || 'File',
								contentType: part.mediaType || part.mimeType
							});
						}
					}
				}
			}
		}

		return attachments;
	}

	// Suggestions for empty state
	const suggestions = [
		{ text: 'I would love to see', label: 'Request a feature' },
		{ text: 'Why SaaS Starter?', label: 'Ask a question' },
		{ text: 'I found a bug!', label: 'Report an issue' },
		{ text: 'Help me set up the project.', label: 'Help me with...' }
	];
</script>

<svelte:body use:lockscroll={isMobile.current} />

<!-- Feedback widget container -->
<div
	class="fixed right-0 bottom-0 z-1 flex h-full w-full origin-bottom animate-in flex-col overflow-hidden bg-secondary shadow-[0_0px_30px_rgba(0,0,0,0.19)] duration-200 ease-out fade-in-0 zoom-in-95 slide-in-from-bottom-4 md:relative md:h-[700px] md:w-[410px] md:origin-bottom-right md:rounded-3xl"
>
	<!-- Animated header with sliding icon and title -->
	<SlidingHeader
		isBackView={threadContext.currentView !== 'overview'}
		defaultIcon={MessagesSquare}
		defaultTitle="Messages"
		backTitle={threadContext.isHandedOff ? assignedAdmin?.name || 'Support Team' : agentName}
		backSubtitle={threadContext.isHandedOff
			? 'Your request is with our team'
			: 'Our bot will reply instantly'}
		titleIcon={threadContext.isHandedOff && !assignedAdmin?.image
			? UsersRound
			: threadContext.isHandedOff
				? undefined
				: Bot}
		titleImage={threadContext.isHandedOff ? assignedAdmin?.image : undefined}
		onBackClick={() => threadContext.goBack()}
		onCloseClick={onClose}
	/>

	<!-- Content area - relative container for both views -->
	<div class="relative min-h-0 flex-1">
		<!-- Thread Overview - always mounted to keep useQuery subscribed -->
		<ThreadsOverview />

		<!-- Chat sheet - slides in from right like iOS/Android navigation -->
		<SlidingPanel open={isChatOpen} class="bg-secondary">
			<ChatRoot
				threadId={threadContext.threadId}
				api={chatApi}
				externalCore={threadContext}
				externalUIContext={chatUIContext}
			>
				<!-- Messages container -->
				<div class="relative min-h-0 w-full flex-1">
					<ChatMessages
						{extractAttachments}
						showEmailPrompt={threadContext.isHandedOff}
						currentEmail={threadContext.notificationEmail ?? ''}
						defaultEmail={page.data.viewer?.email ?? ''}
						onSubmitEmail={handleSubmitEmail}
					/>
				</div>

				<!-- Input area -->
				<ChatInput
					class="mx-4 -translate-y-4 p-0"
					{suggestions}
					placeholder="Type a message or click a suggestion..."
					showCameraButton={true}
					showFileButton={true}
					showHandoffButton={true}
					isHandedOff={threadContext.isHandedOff}
					onScreenshot={handleScreenshot}
					onRequestHandoff={handleRequestHandoff}
					onSend={async (prompt) => {
						if (!prompt) return;

						// Get uploaded file IDs from context
						const fileIds = chatUIContext.uploadedFileIds;

						try {
							threadContext.setAwaitingStream(true);
							await threadContext.sendMessage(client, prompt, {
								fileIds: fileIds.length > 0 ? fileIds : undefined,
								attachments: chatUIContext.attachments
							});
						} catch (error) {
							console.error('[handleSend] Error:', error);
							threadContext.setError('Failed to send message');
							threadContext.setAwaitingStream(false);
						}
					}}
				/>
			</ChatRoot>
		</SlidingPanel>
	</div>
</div>
