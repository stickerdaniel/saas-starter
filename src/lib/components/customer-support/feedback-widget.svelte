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
	import { ArrowUp, Camera, Image as ImageIcon, X, Paperclip, Bot } from '@lucide/svelte';
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

	// Type for the query response with streams
	type MessagesQueryResponse = PaginationResult<SupportMessage> & {
		streams: any; // StreamResult from @convex-dev/agent
	};
	let {
		isScreenshotMode = $bindable(false),
		screenshots = [],
		onClearScreenshot,
		attachedFiles = [],
		onFilesAdded,
		onRemoveFile
	}: {
		isScreenshotMode?: boolean;
		screenshots?: Array<{ blob: Blob; filename: string }>;
		onClearScreenshot?: (index: number) => void;
		attachedFiles?: Array<{ file: File; preview?: string }>;
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

	// Note: Debug logging removed from $effect to prevent infinite reactive loops

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

	// Note: Active stream IDs logging removed to prevent infinite reactive loops

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

		// Normalize message to ensure top-level role exists
		const normalizeMessage = (msg: any) => ({
			...msg,
			role: msg.role || msg.message?.role || 'assistant'
		});

		// Merge: query messages are authoritative, optimistic messages fill gaps
		const messageMap = new Map<string, any>();

		// Add query messages first (normalized)
		for (const msg of queryMessages) {
			messageMap.set(msg.id, normalizeMessage(msg));
		}

		// Add optimistic messages that don't have real versions yet (normalized)
		for (const msg of optimisticMessages) {
			if (!messageMap.has(msg.id)) {
				messageMap.set(msg.id, normalizeMessage(msg));
			}
		}

		return Array.from(messageMap.values()).sort((a, b) => a._creationTime - b._creationTime);
	});

	// Track open state for each message's reasoning accordion
	let reasoningOpenState = $state<Map<string, boolean>>(new Map());

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

		if (streamMessages.length === 0 || allDeltas.length === 0) {
			// No streaming, just return regular messages with proper text extraction
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

				// Extract reasoning from parts array if available
				const reasoning = msg.parts ? extractReasoning(msg.parts) : msg.reasoning || '';

				return {
					...msg,
					displayText,
					displayReasoning: reasoning,
					isStreaming: false
				};
			});
		}

		// Note: Delta logging removed to prevent infinite reactive loops

		// Use framework-agnostic utility to derive UIMessages from deltas
		const [streamingUIMessages] = deriveUIMessagesFromTextStreamParts(
			threadContext.threadId!,
			streamMessages,
			[],
			allDeltas
		);

		// Note: UIMessage logging removed to prevent infinite reactive loops

		// Build maps of order -> streaming text, reasoning, and status
		const streamingTextMap = new Map<number, string>();
		const streamingReasoningMap = new Map<number, string>();
		const streamingStatusMap = new Map<number, string>();

		// Map stream messages by order to get status
		streamMessages.forEach((streamMsg: any) => {
			streamingStatusMap.set(streamMsg.order, streamMsg.status);
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
			}
		});

		// Merge streaming text and reasoning with full messages
		return allMessages.map((msg) => {
			const streamText = streamingTextMap.get(msg.order);
			const streamReasoning = streamingReasoningMap.get(msg.order);
			const streamStatus = streamingStatusMap.get(msg.order);
			const isStreaming = streamStatus === 'streaming';

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
			const displayReasoning = streamReasoning || persistedReasoning;

			console.log('[DEBUG] Final message data:', {
				order: msg.order,
				role: msg.role,
				msgText: msg.text?.substring(0, 100) || '(empty)',
				streamText: streamText?.substring(0, 100) || '(empty)',
				displayText: displayText?.substring(0, 100) || '(empty)',
				streamReasoning: streamReasoning?.substring(0, 100) || '(empty)',
				persistedReasoning: persistedReasoning?.substring(0, 100) || '(empty)',
				displayReasoning: displayReasoning?.substring(0, 100) || '(empty)',
				hasParts: !!msg.parts,
				partsLength: msg.parts?.length || 0
			});

			return {
				...msg,
				displayText,
				displayReasoning,
				isStreaming
			};
		});
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

	/**
	 * Convert Blob or File to base64 string for upload
	 */
	async function blobToBase64(blob: Blob): Promise<string> {
		return new Promise((resolve, reject) => {
			const reader = new FileReader();
			reader.onloadend = () => {
				const base64 = reader.result as string;
				// Remove the data URL prefix (e.g., "data:image/png;base64,")
				const base64Data = base64.split(',')[1];
				resolve(base64Data);
			};
			reader.onerror = reject;
			reader.readAsDataURL(blob);
		});
	}

	async function handleSend() {
		// Prevent duplicate submissions
		if (!inputValue.trim() || !threadContext.threadId || threadContext.isSending) {
			console.log('[handleSend] Blocked - isSending:', threadContext.isSending);
			return;
		}

		const prompt = inputValue.trim();
		threadContext.setSending(true);

		// Add optimistic message
		const optimisticMessage = threadContext.addOptimisticMessage(prompt);

		console.log('[handleSend] Sending message', {
			threadId: threadContext.threadId,
			promptLength: prompt.length,
			optimisticId: optimisticMessage.id,
			attachmentCount: (attachedFiles?.length || 0) + (screenshots?.length || 0)
		});

		// Clear input immediately for better UX
		inputValue = '';

		try {
			// Upload all attachments first
			const fileIds: string[] = [];

			// Upload screenshots
			if (screenshots && screenshots.length > 0) {
				for (const screenshot of screenshots) {
					const base64Data = await blobToBase64(screenshot.blob);
					const uploadResult = await client.action(api.support.files.uploadFile, {
						blob: base64Data,
						filename: screenshot.filename,
						mimeType: screenshot.blob.type
					});
					fileIds.push(uploadResult.fileId);
				}
			}

			// Upload attached files
			if (attachedFiles && attachedFiles.length > 0) {
				for (const { file } of attachedFiles) {
					const base64Data = await blobToBase64(file);
					const uploadResult = await client.action(api.support.files.uploadFile, {
						blob: base64Data,
						filename: file.name,
						mimeType: file.type
					});
					fileIds.push(uploadResult.fileId);
				}
			}

			// Send message with attachments
			const result = await client.mutation(api.support.messages.sendMessage, {
				threadId: threadContext.threadId,
				prompt,
				fileIds: fileIds.length > 0 ? fileIds : undefined
			});

			console.log('[handleSend] Message sent successfully', {
				messageId: result.messageId,
				optimisticId: optimisticMessage.id,
				fileCount: fileIds.length
			});

			// Remove optimistic message immediately - the real message from the query will replace it
			threadContext.removeOptimisticMessage(optimisticMessage.id);

			// Clear attachments after successful send
			if (onClearScreenshot && screenshots) {
				// Clear all screenshots
				for (let i = screenshots.length - 1; i >= 0; i--) {
					onClearScreenshot(i);
				}
			}

			if (onRemoveFile && attachedFiles) {
				// Clear all files
				for (let i = attachedFiles.length - 1; i >= 0; i--) {
					onRemoveFile(i);
				}
			}
		} catch (error) {
			console.error('[handleSend] Failed to send message:', error);
			threadContext.setError('Failed to send message. Please try again.');
			threadContext.removeOptimisticMessage(optimisticMessage.id);
		} finally {
			threadContext.setSending(false);
		}
	}

	function handleValueChange(value: string) {
		inputValue = value;
	}

	function handleCameraClick() {
		isScreenshotMode = true;
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
							<Message class="flex  w-full flex-col gap-2 {isUser ? 'items-end' : 'items-start'}">
								{#if isUser}
									<MessageContent
										class="max-w-[85%] rounded-3xl bg-primary/15 px-5 py-2.5 text-foreground sm:max-w-[75%]"
									>
										{message.displayText}
									</MessageContent>
								{:else}
									<MessageContent class="prose w-full flex-1 p-0 pr-4 ">
										{#if message.displayReasoning || (message.status === 'pending' && !message.displayText)}
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
													<ReasoningContent class="opacity-50" content={message.displayReasoning} />
												{/if}
											</Reasoning>
										{/if}
										{#if message.displayText}
											<Response content={message.displayText} animation={{ enabled: true }} />
										{/if}
									</MessageContent>
								{/if}
							</Message>
						{/each}

						<!-- Show initial loading state when waiting for assistant response -->
						{#if threadContext.isSending && messagesWithStreaming.length > 0 && messagesWithStreaming[messagesWithStreaming.length - 1].role === 'user'}
							<Message class="flex w-full flex-col items-start gap-2">
								<MessageContent class="prose w-full flex-1 rounded-lg bg-transparent p-0 pr-4">
									<Reasoning defaultOpen={false}>
										<ReasoningTrigger isStreaming={false} hasContent={false} />
									</Reasoning>
								</MessageContent>
							</Message>
						{/if}
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
			{#if attachedFiles.length > 0 || (screenshots && screenshots.length > 0)}
				<div class="grid grid-cols-2 gap-2 px-1 pt-1 pb-1">
					{#each attachedFiles as { file, preview }, index}
						<div
							class="flex items-center justify-between gap-2 rounded-lg bg-secondary/50 px-3 py-2"
						>
							<div class="flex items-center gap-2 overflow-hidden">
								{#if preview}
									<img src={preview} alt={file.name} class="size-8 rounded object-cover" />
								{:else}
									<Paperclip class="size-4 shrink-0" />
								{/if}
								<span class="max-w-[80px] truncate text-sm">{file.name}</span>
							</div>
							<button
								onclick={() => onRemoveFile?.(index)}
								class="shrink-0 rounded-full p-1 hover:bg-secondary/50"
								type="button"
								aria-label="Remove file"
							>
								<X class="size-4" />
							</button>
						</div>
					{/each}
					{#if screenshots}
						{#each screenshots as screenshot, index}
							<div
								class="flex items-center justify-between gap-2 rounded-lg bg-secondary/50 px-3 py-2"
							>
								<div class="flex items-center gap-2">
									<ImageIcon class="size-4" />
									<span class="max-w-[80px] truncate text-sm">{screenshot.filename}</span>
								</div>
								<button
									onclick={() => onClearScreenshot?.(index)}
									class="rounded-full p-1 hover:bg-secondary/50"
									type="button"
									aria-label="Remove screenshot"
								>
									<X class="size-4" />
								</button>
							</div>
						{/each}
					{/if}
				</div>
			{/if}

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
					<FileUpload onFilesAdded={(files) => onFilesAdded?.(files)} multiple={true}>
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
					disabled={!inputValue.trim() || threadContext.isSending}
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
