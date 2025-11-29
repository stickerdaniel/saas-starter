<script lang="ts">
	import { useConvexClient } from 'convex-svelte';
	import { api } from '$lib/convex/_generated/api';
	import { supportThreadContext } from './support-thread-context.svelte';
	import { lockscroll } from '@svelte-put/lockscroll';
	import { IsMobile } from '$lib/hooks/is-mobile.svelte.js';

	// Import new chat components
	import { ChatRoot, ChatMessages, ChatInput, type ChatUIContext } from '$lib/chat';
	import type { Attachment, DisplayMessage } from '$lib/chat';

	// Import thread navigation components
	import ThreadsOverview from './threads-overview.svelte';
	import ThreadHeader from './thread-header.svelte';

	let {
		isScreenshotMode = $bindable(false),
		chatUIContext,
		isFeedbackOpen = $bindable(false)
	}: {
		isScreenshotMode?: boolean;
		chatUIContext: ChatUIContext;
		isFeedbackOpen?: boolean;
	} = $props();

	// Get thread context
	const threadContext = supportThreadContext.get();

	// Get Convex client
	const client = useConvexClient();

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
	<!-- Thread Overview - always mounted to keep useQuery subscribed -->
	<ThreadsOverview onClose={() => (isFeedbackOpen = false)} />

	<!-- Chat sheet - slides in from right like iOS/Android navigation -->
	<div
		class="ease absolute inset-0 flex flex-col bg-secondary transition-all duration-350 {threadContext.currentView !==
		'overview'
			? 'translate-x-0 opacity-100'
			: 'pointer-events-none translate-x-full opacity-0'}"
	>
		<ChatRoot
			threadId={threadContext.threadId}
			api={chatApi}
			externalCore={threadContext}
			externalUIContext={chatUIContext}
		>
			<!-- Header with back button -->
			<ThreadHeader onClose={() => (isFeedbackOpen = false)} />

			<!-- Messages container -->
			<div class="relative min-h-0 w-full flex-1">
				<ChatMessages {extractAttachments} />
			</div>

			<!-- Input area -->
			<ChatInput
				class="mx-4 -translate-y-4 p-0"
				{suggestions}
				placeholder="Type a message or click a suggestion..."
				showCameraButton={true}
				showFileButton={true}
				onScreenshot={handleScreenshot}
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

						// Clear attachments after successful send
						chatUIContext.clearAttachments();
					} catch (error) {
						console.error('[handleSend] Error:', error);
						threadContext.setError('Failed to send message');
						threadContext.setAwaitingStream(false);
					}
				}}
			/>
		</ChatRoot>
	</div>
</div>
