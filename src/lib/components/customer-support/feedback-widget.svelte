<script lang="ts">
	import { useConvexClient, useQuery } from 'convex-svelte';
	import { page } from '$app/state';
	import { api } from '$lib/convex/_generated/api';
	import { supportThreadContext } from './support-thread-context.svelte';
	import { lockscroll } from '@svelte-put/lockscroll';
	import { IsMobile } from '$lib/hooks/is-mobile.svelte.js';
	import { toast } from 'svelte-sonner';
	import { ConvexError } from 'convex/values';
	import { getTranslate } from '@tolgee/svelte';

	// Import new chat components
	import { ChatRoot, ChatMessages, ChatInput, type ChatUIContext } from '$lib/chat';
	import type { Attachment, DisplayMessage } from '$lib/chat';

	// Import thread navigation components
	import ThreadsOverview from './threads-overview.svelte';
	import BotIcon from '@lucide/svelte/icons/bot';
	import MessagesSquareIcon from '@lucide/svelte/icons/messages-square';
	import UsersRoundIcon from '@lucide/svelte/icons/users-round';
	import { SlidingPanel } from '$lib/components/ui/sliding-panel';
	import { SlidingHeader } from '$lib/components/ui/sliding-header';

	const { t } = getTranslate();

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

	// Sync handoff status, assigned admin, and notification email to context when thread data loads
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
			// Sync notificationEmail if query has data and context doesn't
			if (threadQuery.data.notificationEmail && !threadContext.notificationEmail) {
				threadContext.notificationEmail = threadQuery.data.notificationEmail;
			}
		}
	});

	// Track previous threadId for draft sync on navigation
	let previousThreadId: string | null = null;

	// Sync drafts when thread changes
	$effect(() => {
		const currentThreadId = threadContext.threadId;

		// On thread change: save old draft, load new draft
		if (previousThreadId !== currentThreadId) {
			// Save draft from old thread (if we had one and input has content)
			if (previousThreadId && chatUIContext.inputValue.trim()) {
				threadContext.setDraft(previousThreadId, chatUIContext.inputValue);
			}

			// Load draft for new thread (or empty for new conversation)
			const draft = threadContext.getDraft(currentThreadId);
			chatUIContext.setInputValue(draft);

			previousThreadId = currentThreadId;
		}
	});

	// Handle handoff request
	async function handleRequestHandoff() {
		await threadContext.requestHandoff(client);
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
								filename: part.filename || $t('chat.attachment.image_fallback')
							});
						} else {
							attachments.push({
								type: 'remote-file',
								url: url,
								filename: part.filename || $t('chat.attachment.file_fallback'),
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
	const suggestions = $derived([
		{
			text: $t('support.suggestion.feature_request_text'),
			label: $t('support.suggestion.feature_request_label')
		},
		{
			text: $t('support.suggestion.question_text'),
			label: $t('support.suggestion.question_label')
		},
		{
			text: $t('support.suggestion.bug_report_text'),
			label: $t('support.suggestion.bug_report_label')
		},
		{ text: $t('support.suggestion.help_text'), label: $t('support.suggestion.help_label') }
	]);

	// Auto-clear rate limit when it expires
	$effect(() => {
		if (!threadContext.rateLimitedUntil) return;

		const timeUntilExpiry = threadContext.rateLimitedUntil - Date.now();
		if (timeUntilExpiry <= 0) {
			threadContext.clearRateLimit();
			return;
		}

		const timeout = setTimeout(() => {
			threadContext.clearRateLimit();
		}, timeUntilExpiry);

		return () => clearTimeout(timeout);
	});

	// Derive title icon based on handoff state
	const titleIcon = $derived.by(() => {
		if (!threadContext.isHandedOff) return BotIcon;
		if (!assignedAdmin?.image) return UsersRoundIcon;
		return undefined;
	});
</script>

<svelte:body use:lockscroll={isMobile.current} />

<!-- Background bleed - extends below screen to cover iOS dynamic viewport gaps -->
<div
	class="pointer-events-none fixed top-full left-0 z-0 h-[50vh] w-full bg-secondary md:hidden"
	aria-hidden="true"
></div>

<!-- Feedback widget container -->
<div
	class="fixed right-0 bottom-0 z-1 flex h-full w-full origin-bottom animate-in flex-col overflow-hidden bg-secondary shadow-[0_0px_30px_rgba(0,0,0,0.19)] duration-200 ease-out fade-in-0 zoom-in-95 slide-in-from-bottom-4 md:relative md:h-[700px] md:max-h-[calc(100svh-3rem-0.75rem-1.25rem-1.25rem)] md:w-[410px] md:origin-bottom-right md:rounded-3xl"
>
	<!-- Animated header with sliding icon and title -->
	<SlidingHeader
		isBackView={threadContext.currentView !== 'overview'}
		defaultIcon={MessagesSquareIcon}
		defaultTitle={$t('support.widget.header.messages')}
		backTitle={threadContext.isHandedOff
			? assignedAdmin?.name || $t('support.header.support_team')
			: agentName}
		backSubtitle={threadContext.isHandedOff
			? $t('support.widget.header.with_team')
			: $t('support.widget.header.bot_response')}
		{titleIcon}
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
					placeholder={$t('support.widget.input.placeholder')}
					showCameraButton={true}
					showFileButton={true}
					showHandoffButton={true}
					isHandedOff={threadContext.isHandedOff}
					isRateLimited={threadContext.isRateLimited}
					onScreenshot={handleScreenshot}
					onRequestHandoff={handleRequestHandoff}
					onSend={async (prompt) => {
						if (!prompt?.trim()) return;
						// In AI mode, block while processing (sending, awaiting stream, or streaming)
						// In handed-off mode, allow fire-and-forget like admin view
						const isProcessing =
							threadContext.isSending ||
							threadContext.isAwaitingStream ||
							threadContext.isStreaming;
						if (!threadContext.isHandedOff && isProcessing) return;

						try {
							await threadContext.sendMessage(client, prompt, {
								fileIds: chatUIContext.uploadedFileIds,
								attachments: chatUIContext.attachments
							});
							chatUIContext.clearAttachments();
							// Clear draft after successful send
							threadContext.clearDraft(threadContext.threadId);
						} catch (error) {
							console.error('[handleSend] Error:', error);

							// Handle rate limit errors with user-friendly toast
							if (error instanceof ConvexError) {
								const data = error.data as { code?: string; retryAfter?: number } | undefined;
								if (data?.code === 'RATE_LIMITED') {
									const retryAfter = data.retryAfter || 60000;
									const seconds = Math.ceil(retryAfter / 1000);
									threadContext.setRateLimited(retryAfter);
									toast.error($t('support.widget.error.rate_limit', { seconds }));
								} else {
									toast.error($t('support.widget.error.send_failed'));
								}
							} else {
								toast.error($t('support.widget.error.send_failed'));
							}
						}
					}}
				/>
			</ChatRoot>
		</SlidingPanel>
	</div>
</div>
