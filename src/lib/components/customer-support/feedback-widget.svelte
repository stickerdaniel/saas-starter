<script lang="ts">
	import { useConvexClient, useQuery } from 'convex-svelte';
	import { authClient } from '$lib/auth-client';
	import { watch } from 'runed';
	import { api } from '$lib/convex/_generated/api';
	import { supportContext } from './support-context.svelte.ts';
	import { lockscroll } from '@svelte-put/lockscroll';
	import { IsMobile } from '$lib/hooks/is-mobile.svelte.ts';
	import { toast } from 'svelte-sonner';
	import { ConvexError } from 'convex/values';
	import { getTranslate } from '@tolgee/svelte';
	import { haptic } from '$lib/hooks/use-haptic.svelte.ts';
	import { isAnonymousUser } from '$lib/convex/utils/anonymousUser';
	import { slide } from 'svelte/transition';
	import { quintOut } from 'svelte/easing';
	import { prefersReducedMotion } from 'svelte/motion';
	import { getChatSessionEpoch } from '$lib/chat/core/chat-persisted-state.ts';

	// Import new chat components
	import { ChatRoot, ChatMessages, ChatInput, type ChatUIContext } from '$lib/chat';

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

	// Session email recovers via cookies on prerendered pages, unlike
	// page.data.viewer which is frozen at build time (prerendering
	// constraints in AGENTS.md)
	let sessionEmail = $state('');
	$effect(() => {
		return authClient.useSession().subscribe((s) => {
			sessionEmail = s.data?.user?.email ?? '';
		});
	});

	const support = supportContext.get();
	const { navigation, conversation, handoff, notifications } = support;
	const anonymousUserId = $derived.by(() => {
		const userId = conversation.userId;
		return isAnonymousUser(userId) ? (userId ?? undefined) : undefined;
	});

	// Derive agent name from context with fallback
	const agentName = $derived(conversation.currentAgentName || 'Kai');

	// Whether the team is the counterpart, which is exactly the inverse of the
	// conversation's send lock. Taken from there rather than recomputed, because two
	// spellings of the same condition are free to drift apart, and the composer
	// then blocks a send the widget has already offered.
	const isHumanOnly = $derived(!conversation.awaitsAgentReply);

	// Derive chat panel open state
	const isChatOpen = $derived(navigation.currentView !== 'overview');

	// Skip animation when loading thread from URL (show instantly)
	const panelDuration = $derived(navigation.skipAnimation ? 0 : 300);

	$effect(() => {
		if (navigation.skipAnimation && isChatOpen) {
			requestAnimationFrame(() => {
				setTimeout(() => {
					navigation.skipAnimation = false;
				});
			});
		}
	});

	// Get Convex client
	const client = useConvexClient();

	// Query thread status (for handoff state)
	const threadQuery = useQuery(api.support.threads.getThread, () =>
		conversation.threadId
			? {
					threadId: conversation.threadId,
					anonymousUserId
				}
			: 'skip'
	);

	// Derive assigned admin - use context value as primary, query as fallback/sync
	const assignedAdmin = $derived(conversation.assignedAdmin ?? threadQuery.data?.assignedAdmin);

	// Sync handoff status, assigned admin, and notification email to context when thread data loads
	// Only sync from query if not already set locally (prevents race conditions)
	$effect(() => {
		if (threadQuery.data) {
			// Sync handoff status if not already handed off locally
			if (!conversation.isHandedOff && threadQuery.data.isHandedOff) {
				conversation.setHandedOff(threadQuery.data.isHandedOff);
			}
			// Sync assignedAdmin if query has newer data (e.g., admin assigned mid-chat)
			if (threadQuery.data.assignedAdmin && !conversation.assignedAdmin) {
				conversation.setAssignedAdmin(threadQuery.data.assignedAdmin);
			}
			// Always sync notificationEmail from query (source of truth, includes optimistic updates)
			conversation.setNotificationEmail(threadQuery.data.notificationEmail ?? null);
		}
	});

	const hasLoadedLatestHumanReply = $derived.by(() => {
		const messageId = threadQuery.data?.lastAdminReplyMessageId;
		if (!messageId) return false;

		return chatUIContext.displayMessages.some(
			(message) =>
				message.id === messageId &&
				message.role === 'assistant' &&
				message.metadata?.provider === 'human'
		);
	});

	let markingReplyMessageId: string | null = null;

	async function markVisibleReplyRead() {
		const threadId = conversation.threadId;
		const lastAdminReplyMessageId = threadQuery.data?.lastAdminReplyMessageId;

		if (
			!isChatOpen ||
			!hasLoadedLatestHumanReply ||
			document.visibilityState !== 'visible' ||
			!threadId ||
			!lastAdminReplyMessageId ||
			threadQuery.data?.hasUnreadAdminReply !== true ||
			markingReplyMessageId === lastAdminReplyMessageId
		) {
			return;
		}

		markingReplyMessageId = lastAdminReplyMessageId;
		try {
			await client.mutation(api.support.readState.markThreadRead, {
				threadId,
				anonymousUserId,
				readThroughMessageId: lastAdminReplyMessageId
			});
		} catch {
			console.warn('[FeedbackWidget.markReplyRead] Failed');
		} finally {
			if (markingReplyMessageId === lastAdminReplyMessageId) markingReplyMessageId = null;
		}
	}

	watch(
		() =>
			[
				isChatOpen,
				hasLoadedLatestHumanReply,
				conversation.threadId,
				threadQuery.data?.lastAdminReplyMessageId,
				threadQuery.data?.hasUnreadAdminReply,
				anonymousUserId
			] as const,
		() => void markVisibleReplyRead()
	);

	// Sync drafts when the selected conversation changes.
	watch(
		() => [conversation.threadId, conversation.threadGeneration] as const,
		([currentThreadId, currentGeneration], previous) => {
			const [previousThreadId, previousGeneration] = previous ?? [undefined, -1];
			const assignedCurrentConversation =
				previousThreadId === null &&
				currentThreadId !== null &&
				currentGeneration === previousGeneration &&
				conversation.isNewConversation;
			if (assignedCurrentConversation) {
				conversation.setDraft(currentThreadId, chatUIContext.inputValue);
				return;
			}

			if (previousThreadId && chatUIContext.inputValue.trim()) {
				conversation.setDraft(previousThreadId, chatUIContext.inputValue);
			}
			chatUIContext.setInputValue(conversation.getDraft(currentThreadId));

			const generationChanged = currentGeneration !== previousGeneration;
			if (generationChanged || (previousThreadId === null && !conversation.isNewConversation)) {
				chatUIContext.clearAttachments();
			}
		}
	);

	// Handle handoff request
	async function handleRequestHandoff() {
		const outcome = await handoff.request(client);
		if (outcome.kind === 'stale') return;
		if (outcome.kind !== 'applied') {
			haptic.trigger('error');
			toast.error($t('support.widget.error.handoff_failed'));
		}
	}

	// Handle email notification submission
	async function handleSubmitEmail(email: string) {
		const outcome = await notifications.setEmail(client, email);
		if (outcome.kind === 'stale') return;
		if (outcome.kind !== 'saved') {
			throw new Error(outcome.kind === 'missing_thread' ? outcome.kind : outcome.code);
		}
	}

	const isMobile = new IsMobile();

	// API configuration for ChatRoot
	const chatApi = {
		listMessages: api.support.messages.listMessages
	};

	// Extract all file URLs from current messages for metadata query
	// Note: UIMessage file parts don't have fileId, only url
	const fileUrls = $derived.by(() => {
		const urls: string[] = [];
		for (const msg of chatUIContext.displayMessages) {
			const content = msg.parts || msg.message?.content;
			if (Array.isArray(content)) {
				for (const part of content) {
					if (part.type === 'file') {
						const url = part.url || (typeof part.data === 'string' ? part.data : null);
						if (url) urls.push(url);
					}
				}
			}
		}
		return [...new Set(urls)].slice(0, 100);
	});

	// Query file metadata for dimensions by URL (extracts storageId server-side)
	const fileMetadataQuery = useQuery(api.support.messages.getFileMetadataBatch, () =>
		fileUrls.length > 0 ? { urls: fileUrls } : 'skip'
	);

	// Derive file metadata map from query (keyed by URL)
	const fileMetadata = $derived(fileMetadataQuery.data ?? {});

	function handleScreenshot() {
		isScreenshotMode = true;
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

	// Auto-clear rate limit when it expires.
	// Uses a plain setTimeout (not runed's useDebounce): calling a useDebounce
	// function inside an $effect makes the effect track the debouncer's internal
	// reactive state and re-run in an `effect_update_depth_exceeded` loop. See #402
	// regression (same fix applied to the avatar preload fallback in threads-overview).
	$effect(() => {
		const until = conversation.rateLimitedUntil;
		if (!until) return;

		const delay = until - Date.now();
		if (delay <= 0) {
			conversation.clearRateLimit();
			return;
		}

		const timer = setTimeout(() => conversation.clearRateLimit(), delay);
		return () => clearTimeout(timer);
	});

	// Derive title icon based on handoff state
	const titleIcon = $derived.by(() => {
		if (!isHumanOnly) return BotIcon;
		if (!assignedAdmin?.image) return UsersRoundIcon;
		return undefined;
	});
</script>

<svelte:document onvisibilitychange={markVisibleReplyRead} />
<svelte:body use:lockscroll={isMobile.current} />

<!-- Background bleed - extends below screen to cover iOS 26 Liquid Glass toolbar gaps -->
<div
	class="pointer-events-none fixed top-full left-0 z-0 h-[50vh] w-full bg-secondary md:hidden"
	aria-hidden="true"
></div>

<!-- Feedback widget container -->
<div
	class="fixed right-0 bottom-0 z-1 flex h-svh w-full origin-bottom flex-col overflow-hidden bg-secondary shadow-[0_0px_30px_rgba(0,0,0,0.19)] ease-out motion-safe:animate-in motion-safe:duration-200 motion-safe:fade-in-0 motion-safe:zoom-in-95 motion-safe:slide-in-from-bottom-4 md:relative md:h-[700px] md:max-h-[calc(100svh-3rem-0.75rem-1.25rem-1.25rem)] md:w-[410px] md:origin-bottom-right md:rounded-3xl"
>
	<!-- Animated header with sliding icon and title -->
	<SlidingHeader
		skipTransition={navigation.skipAnimation}
		isBackView={navigation.currentView !== 'overview'}
		defaultIcon={MessagesSquareIcon}
		defaultTitle={$t('support.widget.header.messages')}
		backTitle={isHumanOnly ? assignedAdmin?.name || $t('support.header.support_team') : agentName}
		backSubtitle={isHumanOnly
			? $t('support.widget.header.with_team')
			: $t('support.widget.header.bot_response')}
		{titleIcon}
		titleImage={isHumanOnly ? assignedAdmin?.image : undefined}
		onBackClick={() => support.goBack()}
		onCloseClick={onClose}
	/>

	<!-- Content area - relative container for both views -->
	<div class="relative min-h-0 flex-1">
		<!-- Thread Overview - always mounted to keep useQuery subscribed -->
		<ThreadsOverview />

		<!-- Chat sheet - slides in from right like iOS/Android navigation -->
		<SlidingPanel open={isChatOpen} duration={panelDuration} class="bg-secondary">
			<ChatRoot
				threadId={conversation.threadId}
				api={chatApi}
				externalCore={conversation}
				externalUIContext={chatUIContext}
				listMessagesArgs={anonymousUserId ? { anonymousUserId } : undefined}
			>
				<!-- Messages container -->
				<div class="relative min-h-0 w-full flex-1">
					<ChatMessages
						{fileMetadata}
						showEmailPrompt={isHumanOnly}
						currentEmail={conversation.notificationEmail ?? ''}
						isEmailPending={notifications.isPending}
						defaultEmail={sessionEmail}
						onSubmitEmail={handleSubmitEmail}
					/>
				</div>

				<!-- Input area -->
				<ChatInput
					class="relative z-20 mx-4 -translate-y-4 p-0"
					{suggestions}
					placeholder={$t('support.widget.input.placeholder')}
					placeholderNoSuggestions={$t('support.widget.input.placeholder_no_suggestions')}
					showCameraButton={true}
					showFileButton={true}
					showHandoffButton={true}
					{isHumanOnly}
					isRateLimited={conversation.isRateLimited}
					onScreenshot={handleScreenshot}
					onRequestHandoff={handleRequestHandoff}
					onSend={async (prompt) => {
						if (!prompt?.trim()) return;
						// In AI mode, block while processing (sending, awaiting stream, or streaming)
						// In handed-off mode, allow fire-and-forget like admin view
						if (!isHumanOnly && chatUIContext.isProcessing) return;

						const originThreadId = conversation.threadId;
						const sessionEpoch = getChatSessionEpoch();
						const threadGeneration = conversation.threadGeneration;
						const operationRevision = conversation.currentOperationRevision;
						const draftCheckpoint = conversation.captureDraftCheckpoint(originThreadId);
						const fileIds = chatUIContext.uploadedFileIds;
						const attachments = [...chatUIContext.attachments];
						try {
							const result = await conversation.sendMessage(client, prompt, {
								fileIds,
								attachments
							});
							if (
								!conversation.isSendOperationCurrent(
									sessionEpoch,
									threadGeneration,
									operationRevision
								)
							) {
								return;
							}
							conversation.clearDraftIfUnchanged(draftCheckpoint, result.threadId);
						} catch (error) {
							if (
								!conversation.isSendOperationCurrent(
									sessionEpoch,
									threadGeneration,
									operationRevision
								)
							) {
								throw error;
							}
							console.error('[FeedbackWidget.send] Failed');

							// Handle rate limit errors with user-friendly toast
							if (error instanceof ConvexError) {
								const data = error.data as { code?: string; retryAfter?: number } | undefined;
								if (data?.code === 'RATE_LIMITED') {
									const retryAfter = data.retryAfter || 60000;
									const seconds = Math.ceil(retryAfter / 1000);
									conversation.setRateLimited(retryAfter);
									haptic.trigger('error');
									toast.error($t('support.widget.error.rate_limit', { seconds }));
								} else {
									haptic.trigger('error');
									toast.error($t('support.widget.error.send_failed'));
								}
							} else {
								haptic.trigger('error');
								toast.error($t('support.widget.error.send_failed'));
							}

							// Rethrow so ChatInput restores its captured composer state.
							throw error;
						}
					}}
				/>

				{#if !isHumanOnly}
					<!-- EU AI Act Art. 50(1): the widget is the second entry point into
						 the same AI thread, so it carries the same disclosure. Dropped
						 once a human takes over the thread; the slide collapses its
						 height so the composer settles instead of jumping. -->
					<p
						transition:slide={{
							duration: prefersReducedMotion.current ? 0 : 200,
							easing: quintOut
						}}
						class="pointer-events-none -mt-2 px-4 pb-2 text-center text-[11px] text-balance text-muted-foreground"
					>
						{$t('support.chatbar.disclosure')}
					</p>
				{/if}
			</ChatRoot>
		</SlidingPanel>
	</div>
</div>
