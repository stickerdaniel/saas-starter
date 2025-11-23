<script lang="ts">
	import { useQuery, useConvexClient } from 'convex-svelte';
	import { api } from '$lib/convex/_generated/api';
	import {
		PromptInput,
		PromptInputAction,
		PromptInputActions,
		PromptInputTextarea
	} from '$lib/components/prompt-kit/prompt-input';
	import { PromptSuggestion } from '$lib/components/prompt-kit/prompt-suggestion';
	import {
		ChatContainerRoot,
		ChatContainerContent,
		ChatContainerScrollAnchor
	} from '$lib/components/prompt-kit/chat-container';
	import { ScrollButton } from '$lib/components/prompt-kit/scroll-button';
	import { Message, MessageContent } from '$lib/components/prompt-kit/message';
	import { Button } from '$lib/components/ui/button';
	import { Avatar, AvatarImage } from '$lib/components/ui/avatar';
	import { ArrowUp, Camera, Paperclip } from '@lucide/svelte';
	import { supportThreadContext } from './support-thread-context.svelte';
	import { FileUpload, FileUploadTrigger } from '$lib/components/prompt-kit/file-upload';
	import ProgressiveBlur from '$blocks/magic/ProgressiveBlur.svelte';
	import { Response } from '$lib/components/ai-elements/response';
	import memberFour from '$blocks/team/avatars/member-four.webp';
	import memberTwo from '$blocks/team/avatars/member-two.webp';
	import memberFive from '$blocks/team/avatars/member-five.webp';
	// Import framework-agnostic delta processing utilities
	import { deriveUIMessagesFromTextStreamParts, extractReasoning } from './delta-utils.js';
	import type { StreamDelta } from '@convex-dev/agent/validators';
	import type { UIMessage } from '@convex-dev/agent';
	import {
		Reasoning,
		ReasoningTrigger,
		ReasoningContent
	} from '$lib/components/ai-elements/reasoning';
	import type { PaginationResult } from 'convex/server';
	import type { SupportMessage } from './support-thread-context.svelte';
	import Attachments, { type Attachment, type UploadState } from './attachments.svelte';

	// Type for the query response with streams
	type MessagesQueryResponse = PaginationResult<SupportMessage> & {
		streams: any; // StreamResult from @convex-dev/agent
	};
	let {
		isScreenshotMode = $bindable(false),
		screenshots = [],
		onClearScreenshot,
		attachedFiles = [],
		onFilesAdded: onFilesAddedProp,
		onRemoveFile
	}: {
		isScreenshotMode?: boolean;
		screenshots?: Array<{ blob: Blob; filename: string; uploadState: UploadState }>;
		onClearScreenshot?: (index: number) => void;
		attachedFiles?: Array<{ file: File; preview?: string; uploadState: UploadState }>;
		onFilesAdded?: (files: File[]) => void;
		onRemoveFile?: (index: number) => void;
	} = $props();

	// Get thread context
	const threadContext = supportThreadContext.get();

	// Get Convex client for mutations
	const client = useConvexClient();

	let inputValue = $state('');

	/**
	 * Extract text from user message content (handles string, array, object, undefined)
	 */
	function extractUserMessageText(msg: any): string {
		// First try msg.text (UIMessage field)
		if (msg.text && typeof msg.text === 'string') {
			return msg.text;
		}

		// Then try msg.message.content
		if (msg.message?.content !== undefined && msg.message?.content !== null) {
			const content = msg.message.content;

			// String content (most common)
			if (typeof content === 'string') {
				return content;
			}

			// Array content (multimodal messages)
			if (Array.isArray(content)) {
				return content
					.map((part) => {
						if (typeof part === 'string') return part;
						if (part && typeof part === 'object' && 'text' in part) return part.text;
						return '';
					})
					.filter(Boolean)
					.join(' ');
			}

			// Object content with text field
			if (typeof content === 'object' && 'text' in content) {
				return content.text;
			}
		}

		// Debug: Could not extract text - check message structure if needed

		return '';
	}

	// Query messages with streamArgs for streaming support
	const messagesQuery = $derived(
		threadContext.threadId
			? useQuery(api.support.messages.listMessages, {
					threadId: threadContext.threadId,
					paginationOpts: { numItems: 50, cursor: null },
					streamArgs: { kind: 'list' as const, startOrder: 0 }
				})
			: undefined
	);

	// Extract active stream IDs for delta query
	const activeStreamIds = $derived.by(() => {
		const messagesData = messagesQuery?.data as MessagesQueryResponse | undefined;
		return messagesData?.streams?.kind === 'list'
			? messagesData.streams.messages
					.filter(
						(m: any) =>
							m.status === 'streaming' || m.status === 'finished' || m.status === 'aborted'
					)
					.map((m: any) => m.streamId)
			: [];
	});

	// Second query: Get text deltas for active streams
	const deltasQuery = $derived(
		threadContext.threadId && activeStreamIds.length > 0
			? useQuery(api.support.messages.listMessages, {
					threadId: threadContext.threadId,
					paginationOpts: { numItems: 0, cursor: null },
					streamArgs: {
						kind: 'deltas' as const,
						cursors: activeStreamIds.map((streamId: string) => ({
							streamId,
							cursor: 0
						}))
					}
				})
			: undefined
	);

	// Merge query messages with optimistic messages from context
	// This avoids the reactive loop that would occur if we used $effect to update context
	const allMessages = $derived.by(() => {
		const messagesData = messagesQuery?.data as MessagesQueryResponse | undefined;
		const queryMessages = messagesData?.page || [];
		const optimisticMessages = threadContext.messages.filter((m) => m.metadata?.optimistic);

		console.log('[allMessages] Deduplication debug:', {
			queryMessageCount: queryMessages.length,
			queryMessageIds: queryMessages.map((m) => ({
				id: m.id,
				role: m.role,
				text: m.text?.substring(0, 30)
			})),
			optimisticMessageCount: optimisticMessages.length,
			optimisticMessageIds: optimisticMessages.map((m) => ({
				id: m.id,
				role: m.role,
				text: m.text?.substring(0, 30)
			}))
		});

		// Normalize message to ensure top-level role exists
		const normalizeMessage = (msg: any) => ({
			...msg,
			role: msg.role || msg.message?.role || 'assistant'
		});

		// Merge: query messages are authoritative, optimistic messages fill gaps
		const messageMap = new Map<string, any>();

		// Add query messages first (normalized)
		for (const msg of queryMessages) {
			console.log('[allMessages] Adding query message:', { id: msg.id, role: msg.role });
			messageMap.set(msg.id, normalizeMessage(msg));
		}

		// Add optimistic messages that don't have real versions yet (normalized)
		// Match by text content, not by ID or position
		for (const msg of optimisticMessages) {
			// Check if there's a real message with matching text and role
			const hasRealMatch = queryMessages.some((qm) => qm.role === msg.role && qm.text === msg.text);

			if (hasRealMatch) {
				console.log('[allMessages] Skipping optimistic message (real match found by text):', {
					id: msg.id,
					role: msg.role,
					text: msg.text?.substring(0, 30),
					reason: 'Real message with same text exists'
				});
				continue;
			}

			// No real match yet, keep the optimistic message
			const hasMatchById = messageMap.has(msg.id);
			console.log('[allMessages] Checking optimistic message:', {
				id: msg.id,
				role: msg.role,
				hasMatchInQueryById: hasMatchById,
				hasRealMatchByText: hasRealMatch,
				willAdd: !hasMatchById
			});
			if (!messageMap.has(msg.id)) {
				messageMap.set(msg.id, normalizeMessage(msg));
			}
		}

		const result = Array.from(messageMap.values()).sort(
			(a, b) => a._creationTime - b._creationTime
		);
		console.log('[allMessages] Final merged messages:', {
			totalCount: result.length,
			messages: result.map((m) => ({ id: m.id, role: m.role, text: m.text?.substring(0, 30) }))
		});

		return result;
	});

	// Track open state for each message's reasoning accordion
	let reasoningOpenState = $state<Map<string, boolean>>(new Map());

	// Cache to preserve reasoning content during query transitions (prevents "Connecting..." flash)
	let reasoningCache = $state<Map<number, string>>(new Map());
	// Sticky awaiting state to bridge the gap until the first stream metadata arrives
	let isAwaitingStream = $state(false);
	// Cache last-known stream status to survive brief query reloads
	let streamStatusCache = $state<Map<number, 'streaming' | 'finished' | 'aborted'>>(new Map());

	// Process streaming deltas using framework-agnostic utilities
	const messagesWithStreaming = $derived.by(() => {
		// Get stream metadata and deltas
		// Type assertion: Convex returns { ...paginated, streams } from listMessages
		const messagesData = messagesQuery?.data as MessagesQueryResponse | undefined;
		const deltasData = deltasQuery?.data as MessagesQueryResponse | undefined;

		const streamMessages =
			messagesData?.streams?.kind === 'list' ? messagesData.streams.messages || [] : [];

		const allDeltas =
			deltasData?.streams?.kind === 'deltas'
				? ((deltasData.streams.deltas || []) as StreamDelta[])
				: [];

		if (streamMessages.length === 0) {
			// No streams visible (likely a brief query reload) — preserve streaming state via cache
			return allMessages.map((msg) => {
				const isUser = msg.role === 'user';
				let displayText = '';
				if (isUser) {
					// For user messages, use robust extraction
					displayText = extractUserMessageText(msg);
				} else {
					// For assistant messages, use msg.text
					displayText = msg.text || '';
				}

				// Extract reasoning from parts array if available (leave as-is; focus is on placeholder)
				const reasoning = msg.parts ? extractReasoning(msg.parts) : msg.reasoning || '';
				const cachedStatus = streamStatusCache.get(msg.order);

				return {
					...msg,
					displayText,
					displayReasoning: reasoning,
					// Use cached status to avoid placeholder flicker
					isStreaming: cachedStatus === 'streaming',
					hasReasoningStream: streamStatusCache.has(msg.order)
				};
			});
		}

		// We have streams - process them even if deltas are still loading
		// If allDeltas is empty (query reloading), streamingUIMessages will be empty,
		// but streamingStatusMap will still have entries to preserve hasReasoningStream

		// Use framework-agnostic utility to derive UIMessages from deltas
		const [streamingUIMessages] = deriveUIMessagesFromTextStreamParts(
			threadContext.threadId!,
			streamMessages,
			[],
			allDeltas
		);

		// Build maps of order -> streaming text, reasoning, and status
		const streamingTextMap = new Map<number, string>();
		const streamingReasoningMap = new Map<number, string>();
		const streamingStatusMap = new Map<number, string>();

		// Map stream messages by order to get status
		streamMessages.forEach((streamMsg: any) => {
			streamingStatusMap.set(streamMsg.order, streamMsg.status);
			// Persist status in cache for stability across reloads
			streamStatusCache.set(streamMsg.order, streamMsg.status);
		});

		streamingUIMessages.forEach((uiMsg: UIMessage) => {
			streamingTextMap.set(uiMsg.order, uiMsg.text || '');
			const reasoning = extractReasoning(uiMsg.parts || []);
			console.log('[DEBUG] UIMessage reasoning extraction:', {
				order: uiMsg.order,
				partsCount: uiMsg.parts?.length || 0,
				parts: uiMsg.parts,
				extractedReasoning: reasoning,
				reasoningLength: reasoning?.length || 0
			});
			if (reasoning) {
				streamingReasoningMap.set(uiMsg.order, reasoning);
				// Update cache with latest streaming reasoning
				reasoningCache.set(uiMsg.order, reasoning);
			}
		});

		// Merge streaming text and reasoning with full messages
		return allMessages.map((msg) => {
			const streamText = streamingTextMap.get(msg.order);
			const streamReasoning = streamingReasoningMap.get(msg.order);
			const streamStatus = streamingStatusMap.get(msg.order);
			const isStreaming = streamStatus === 'streaming';
			const hasReasoningStream = streamStatus !== undefined; // Stream exists (any status)

			// Extract text properly for both user and assistant messages
			const isUser = msg.role === 'user';
			let displayText = '';
			if (isUser) {
				// For user messages, use robust extraction
				displayText = extractUserMessageText(msg);
			} else {
				// For assistant messages, use streaming text or fallback to msg.text
				displayText = streamText || msg.text || '';
			}

			// Extract reasoning from streaming or persisted parts
			const persistedReasoning = msg.parts ? extractReasoning(msg.parts) : msg.reasoning || '';
			const cachedReasoning = reasoningCache.get(msg.order) || '';

			// Three-tier fallback: streaming → cached → persisted
			// This prevents "Connecting..." flash during query reloads
			const currentReasoning = streamReasoning || persistedReasoning;
			const displayReasoning = currentReasoning || cachedReasoning;

			// Update cache if we have new content
			if (currentReasoning) {
				reasoningCache.set(msg.order, currentReasoning);
			}

			// Clear cache once persisted reasoning exists (no longer needed)
			if (persistedReasoning && cachedReasoning && !streamReasoning) {
				reasoningCache.delete(msg.order);
			}

			console.log('[DEBUG] Final message data:', {
				order: msg.order,
				role: msg.role,
				msgText: msg.text?.substring(0, 100) || '(empty)',
				streamText: streamText?.substring(0, 100) || '(empty)',
				displayText: displayText?.substring(0, 100) || '(empty)',
				streamReasoning: streamReasoning?.substring(0, 100) || '(empty)',
				cachedReasoning: cachedReasoning?.substring(0, 100) || '(empty)',
				persistedReasoning: persistedReasoning?.substring(0, 100) || '(empty)',
				displayReasoning: displayReasoning?.substring(0, 100) || '(empty)',
				hasParts: !!msg.parts,
				partsLength: msg.parts?.length || 0,
				hasReasoningStream
			});

			return {
				...msg,
				displayText,
				displayReasoning,
				isStreaming,
				hasReasoningStream
			};
		});
	});

	// Derived helper: is the last message authored by the user?
	const lastMessageIsUser = $derived.by(() => {
		const len = allMessages.length;
		return len > 0 ? allMessages[len - 1].role === 'user' : false;
	});

	// Have we seen any active stream metadata yet?
	const hasActiveStreams = $derived.by(() => {
		const messagesData = messagesQuery?.data as MessagesQueryResponse | undefined;
		if (messagesData?.streams?.kind !== 'list') return false;
		const arr = messagesData.streams?.messages || [];
		return arr.length > 0;
	});

	// Clear sticky awaiting once evidence of streaming or assistant output appears
	$effect(() => {
		if (hasActiveStreams) {
			isAwaitingStream = false;
			return;
		}
		const last = messagesWithStreaming.length
			? messagesWithStreaming[messagesWithStreaming.length - 1]
			: undefined;
		if (last && last.role === 'assistant' && (last.displayText || last.displayReasoning)) {
			isAwaitingStream = false;
		}
	});

	// Auto-manage reasoning accordion state: open when reasoning arrives, close when response starts
	$effect(() => {
		messagesWithStreaming.forEach((message) => {
			const hasReasoning = !!message.displayReasoning;
			const hasResponse = !!message.displayText;

			// Auto-open when reasoning arrives without response
			if (hasReasoning && !hasResponse) {
				reasoningOpenState.set(message.id, true);
			}
			// Auto-close when response starts
			else if (hasResponse && reasoningOpenState.get(message.id)) {
				reasoningOpenState.set(message.id, false);
			}
		});
	});

	// Check if any uploads are pending or failed
	const hasUploadingFiles = $derived.by(() => {
		const fileUploading = attachedFiles.some((f) => f.uploadState?.status === 'uploading');
		const screenshotUploading =
			screenshots?.some((s) => s.uploadState?.status === 'uploading') || false;
		return fileUploading || screenshotUploading;
	});

	const hasFailedUploads = $derived.by(() => {
		const fileFailed = attachedFiles.some((f) => f.uploadState?.status === 'error');
		const screenshotFailed = screenshots?.some((s) => s.uploadState?.status === 'error') || false;
		return fileFailed || screenshotFailed;
	});

	// Disable send button if uploads pending or failed
	const canSend = $derived(!hasUploadingFiles && !hasFailedUploads && !!inputValue.trim());

	async function handleSend() {
		if (!canSend) return;

		const prompt = inputValue.trim();

		// Clear input immediately for better UX
		inputValue = '';

		try {
			// Collect all successfully uploaded fileIds
			const fileIds: string[] = [];

			// Collect screenshot fileIds
			for (const screenshot of screenshots || []) {
				if (screenshot.uploadState.status === 'success' && screenshot.uploadState.fileId) {
					fileIds.push(screenshot.uploadState.fileId);
				}
			}

			// Collect attached file fileIds
			for (const { uploadState } of attachedFiles) {
				if (uploadState.status === 'success' && uploadState.fileId) {
					fileIds.push(uploadState.fileId);
				}
			}

			// Send message immediately (no upload delay!)
			isAwaitingStream = true;
			await threadContext.sendMessage(client, prompt, {
				fileIds: fileIds.length > 0 ? fileIds : undefined,
				attachments: allAttachments // Pass local attachments for optimistic UI
			});

			// Clear attachments after successful send
			if (onClearScreenshot && screenshots) {
				for (let i = screenshots.length - 1; i >= 0; i--) {
					onClearScreenshot(i);
				}
			}

			if (onRemoveFile && attachedFiles) {
				for (let i = attachedFiles.length - 1; i >= 0; i--) {
					onRemoveFile(i);
				}
			}
		} catch (error) {
			console.error('[handleSend] Error:', error);
			threadContext.setError('Failed to send message');
			isAwaitingStream = false;
		}
	}

	function handleValueChange(value: string) {
		inputValue = value;
	}

	function handleCameraClick() {
		isScreenshotMode = true;
	}

	/**
	 * Convert attachedFiles and screenshots to unified attachment format
	 */
	const allAttachments = $derived.by((): Attachment[] => {
		const result: Attachment[] = [];

		// Add regular files
		attachedFiles.forEach(({ file, preview, uploadState }) => {
			result.push({ type: 'file', file, preview, uploadState });
		});

		// Add screenshots
		if (screenshots) {
			screenshots.forEach(({ blob, filename, uploadState }) => {
				result.push({ type: 'screenshot', blob, filename, uploadState });
			});
		}

		return result;
	});

	/**
	 * Handle attachment removal - map index back to correct array and handler
	 */
	function handleRemoveAttachment(index: number) {
		const fileCount = attachedFiles.length;

		if (index < fileCount) {
			// Remove from attachedFiles
			onRemoveFile?.(index);
		} else {
			// Remove from screenshots
			onClearScreenshot?.(index - fileCount);
		}
	}

	function handleFilesAdded(files: File[]) {
		// Filter out duplicate files by checking name and size
		const existingKeys = new Set(attachedFiles.map((f) => `${f.file.name}-${f.file.size}`));

		const newFiles = files.filter((file) => {
			const key = `${file.name}-${file.size}`;
			if (existingKeys.has(key)) {
				return false;
			}
			existingKeys.add(key);
			return true;
		});

		if (newFiles.length > 0) {
			onFilesAddedProp?.(newFiles);
		}
	}

	/**
	 * Extract attachments from message content
	 */
	function extractAttachments(msg: SupportMessage): Attachment[] {
		// 1. Optimistic attachments
		if (msg.localAttachments && msg.localAttachments.length > 0) {
			return msg.localAttachments;
		}

		const attachments: Attachment[] = [];

		// 2. Real message content
		// Use parts if available (resolved by backend), otherwise fallback to content
		const content = msg.parts || msg.message?.content;

		if (Array.isArray(content)) {
			for (const part of content) {
				if (part.type === 'file') {
					// part.url (from parts) or part.data (from content)
					const url = part.url || (typeof part.data === 'string' ? part.data : null);

					if (url) {
						// Check if it is an image (via mediaType)
						const isImage =
							part.mediaType?.startsWith('image/') || part.mimeType?.startsWith('image/');

						if (isImage) {
							attachments.push({
								type: 'image',
								url: url,
								filename: part.filename || 'Image'
							});
						} else {
							// Remote file
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
</script>

<!-- Feedback widget container -->
<div
	class="right-0 bottom-0 flex h-full w-full origin-bottom-right animate-in flex-col overflow-hidden bg-secondary shadow-[0_0px_30px_rgba(0,0,0,0.19)] duration-200 ease-out fade-in-0 zoom-in-95 slide-in-from-bottom-4 sm:h-[700px] sm:w-[410px] sm:rounded-3xl"
>
	<!-- Messages container -->
	<div class="relative min-h-0 w-full flex-1">
		<ChatContainerRoot class="relative h-full">
			<ChatContainerContent class="!h-full">
				{#if messagesWithStreaming.length === 0}
					<!-- Empty state -->
					<div class="flex !h-full flex-col justify-start">
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
					<!-- Messages list -->
					<div class="space-y-4 py-16 pr-5 pl-9">
						{#each messagesWithStreaming as message (message.id)}
							{@const isUser = message.role === 'user'}
							{@const messageAttachments = extractAttachments(message)}
							<div class="flex w-full flex-col gap-1 {isUser ? 'items-end' : 'items-start'}">
								{#if messageAttachments.length > 0}
									<div class="max-w-[85%] sm:max-w-[75%]">
										<Attachments
											attachments={messageAttachments}
											readonly={true}
											columns={2}
											class="px-0"
										/>
									</div>
								{/if}
								<Message class="flex w-full flex-col gap-2 {isUser ? 'items-end' : 'items-start'}">
									{#if isUser}
										<MessageContent
											class="max-w-[85%] bg-primary/15 px-5 py-2.5 text-foreground sm:max-w-[75%] {messageAttachments.length >
											0
												? 'rounded-3xl rounded-tr-lg'
												: 'rounded-3xl'}"
										>
											{message.displayText}
										</MessageContent>
									{:else}
										<MessageContent class="prose w-full flex-1 p-0 pr-4 ">
											{#if message.displayReasoning || message.hasReasoningStream || (message.status === 'pending' && !message.displayText)}
												{@const isReasoningOpen = reasoningOpenState.get(message.id) ?? false}
												{@const shouldUseShimmer = message.displayReasoning && !message.displayText}
												{@const hasReasoningContent = !!message.displayReasoning}
												<Reasoning
													open={isReasoningOpen}
													onOpenChange={(open) => reasoningOpenState.set(message.id, open)}
												>
													<ReasoningTrigger
														isStreaming={shouldUseShimmer}
														hasContent={hasReasoningContent}
													/>
													{#if message.displayReasoning}
														<ReasoningContent
															class="opacity-50"
															content={message.displayReasoning}
														/>
													{/if}
												</Reasoning>
											{/if}
											{#if message.displayText}
												<Response content={message.displayText} animation={{ enabled: true }} />
											{/if}
										</MessageContent>
									{/if}
								</Message>
							</div>
						{/each}
					</div>
				{/if}

				<!-- Scroll anchor for auto-scroll functionality -->
				<ChatContainerScrollAnchor />

				<!-- Overlay area pinned to bottom of scroll container -->
				<div class="pointer-events-none relative sticky bottom-0 z-10 min-h-16 w-full">
					<!-- Progressive blur as background overlay -->
					<ProgressiveBlur
						class="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-20 w-full"
						direction="bottom"
						blurIntensity={1}
					/>
					<!-- Scroll button over the blur -->
					<ScrollButton class="pointer-events-auto absolute right-9 bottom-6 z-20" />
				</div>
			</ChatContainerContent>
		</ChatContainerRoot>
	</div>

	<!-- Input area at bottom with high z-index -->
	<PromptInput
		class="relative z-20 mx-4 -translate-y-4 p-0"
		value={inputValue}
		isLoading={threadContext.isSending}
		onValueChange={handleValueChange}
		onSubmit={handleSend}
	>
		<!-- Suggestion chips - shown when chat is empty -->
		{#if messagesWithStreaming.length === 0 && !inputValue.trim()}
			<div class="absolute top-0 z-20 translate-y-[-100%] pb-2">
				<div class="flex flex-wrap gap-2">
					<PromptSuggestion onclick={() => (inputValue = 'I would love to see')}>
						Request a feature
					</PromptSuggestion>

					<PromptSuggestion onclick={() => (inputValue = 'Why SaaS Starter?')}>
						Ask a question
					</PromptSuggestion>

					<PromptSuggestion onclick={() => (inputValue = 'I found a bug!')}>
						Report an issue
					</PromptSuggestion>

					<PromptSuggestion onclick={() => (inputValue = 'Help me set up the project.')}>
						Help me with...
					</PromptSuggestion>
				</div>
			</div>
		{/if}
		<div class="flex flex-col p-2">
			<Attachments
				class="mx-2 mt-2"
				attachments={allAttachments}
				onRemove={handleRemoveAttachment}
				columns={2}
			/>

			<PromptInputTextarea
				placeholder="Type a message or click a suggestion..."
				class="min-h-[44px] pt-3 pl-4 text-base leading-[1.3]"
			/>

			<PromptInputActions class="mt-5 flex w-full items-center justify-between gap-2 px-3 pb-3">
				<div class="flex items-center gap-2">
					<PromptInputAction>
						{#snippet tooltip()}
							<p>Mark the bug</p>
						{/snippet}
						<Button
							variant="outline"
							size="icon"
							class="size-9 rounded-full"
							onclick={handleCameraClick}
						>
							<Camera class="h-[18px] w-[18px]" />
						</Button>
					</PromptInputAction>
					<FileUpload onFilesAdded={handleFilesAdded} multiple={true}>
						<PromptInputAction>
							{#snippet tooltip()}
								<p>Attach files</p>
							{/snippet}
							<FileUploadTrigger asChild={true}>
								<Button variant="outline" size="icon" class="size-9 rounded-full">
									<Paperclip class="h-[18px] w-[18px]" />
								</Button>
							</FileUploadTrigger>
						</PromptInputAction>
					</FileUpload>
					<!-- <PromptInputAction>
						{#snippet tooltip()}
							<p>Record screen</p>
						{/snippet}
						<Button variant="outline" size="icon" class="size-9 rounded-full">
							<Video class="h-[18px] w-[18px]" />
						</Button>
					</PromptInputAction> -->
				</div>

				<Button
					size="icon"
					disabled={!canSend || threadContext.isSending}
					onclick={handleSend}
					class="size-9 rounded-full"
					aria-label="Send"
				>
					{#if !threadContext.isSending}
						<ArrowUp class="h-[18px] w-[18px]" />
					{:else}
						<span class="size-3 rounded-xs bg-white"></span>
					{/if}
				</Button>
			</PromptInputActions>
		</div>
	</PromptInput>
</div>
