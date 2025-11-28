<script lang="ts">
	import { useConvexClient } from 'convex-svelte';
	import { api } from '$lib/convex/_generated/api';
	import { Button } from '$lib/components/ui/button';
	import { Avatar, AvatarImage } from '$lib/components/ui/avatar';
	import { X } from '@lucide/svelte';
	import { supportThreadContext } from './support-thread-context.svelte';
	import memberFour from '$blocks/team/avatars/member-four.webp';
	import memberTwo from '$blocks/team/avatars/member-two.webp';
	import memberFive from '$blocks/team/avatars/member-five.webp';
	import type { UploadState } from './attachments.svelte';
	import { lockscroll } from '@svelte-put/lockscroll';
	import { IsMobile } from '$lib/hooks/is-mobile.svelte.js';

	// Import new chat components
	import { ChatRoot, ChatMessages, ChatInput } from '$lib/chat';
	import type { Attachment, DisplayMessage } from '$lib/chat';

	let {
		isScreenshotMode = $bindable(false),
		screenshots = [],
		onClearScreenshot,
		attachedFiles = [],
		onFilesAdded: onFilesAddedProp,
		onRemoveFile,
		isFeedbackOpen = $bindable(false)
	}: {
		isScreenshotMode?: boolean;
		screenshots?: Array<{ blob: Blob; filename: string; uploadState: UploadState }>;
		onClearScreenshot?: (index: number) => void;
		attachedFiles?: Array<{ file: File; preview?: string; uploadState: UploadState }>;
		onFilesAdded?: (files: File[]) => void;
		onRemoveFile?: (index: number) => void;
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

	// Convert attachedFiles and screenshots to unified attachment format
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

	// Handle attachment removal - map index back to correct array and handler
	function handleRemoveAttachment(index: number) {
		const fileCount = attachedFiles.length;

		if (index < fileCount) {
			onRemoveFile?.(index);
		} else {
			onClearScreenshot?.(index - fileCount);
		}
	}

	function handleFilesAdded(files: File[]) {
		// Filter out duplicate files
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
	class="fixed right-0 bottom-0 z-1 flex h-full w-full origin-bottom animate-in flex-col overflow-hidden bg-secondary shadow-[0_0px_30px_rgba(0,0,0,0.19)] duration-200 ease-out fade-in-0 zoom-in-95 slide-in-from-bottom-4 md:static md:h-[700px] md:w-[410px] md:origin-bottom-right md:rounded-3xl"
>
	<ChatRoot threadId={threadContext.threadId} api={chatApi} externalCore={threadContext}>
		<!-- Messages container -->
		<div class="relative min-h-0 w-full flex-1">
			<!-- Mobile Close Button -->
			{#if isMobile.current}
				<Button
					variant="default"
					size="icon"
					class="absolute right-0 z-1 m-4 h-12 w-12 rounded-full transition-colors transition-transform duration-300 ease-in-out hover:scale-110 hover:bg-primary"
					onclick={() => (isFeedbackOpen = false)}
				>
					<X class="size-6" />
				</Button>
			{/if}

			<ChatMessages {extractAttachments}>
				{#snippet emptyState()}
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
				{/snippet}
			</ChatMessages>
		</div>

		<!-- Input area -->
		<ChatInput
			class="mx-4 -translate-y-4 p-0"
			attachments={allAttachments}
			{suggestions}
			placeholder="Type a message or click a suggestion..."
			showCameraButton={true}
			showFileButton={true}
			onScreenshot={handleScreenshot}
			onFilesAdded={handleFilesAdded}
			onRemoveAttachment={handleRemoveAttachment}
			onSend={async (prompt) => {
				if (!prompt) return;

				// Collect file IDs
				const fileIds: string[] = [];
				for (const screenshot of screenshots || []) {
					if (screenshot.uploadState.status === 'success' && screenshot.uploadState.fileId) {
						fileIds.push(screenshot.uploadState.fileId);
					}
				}
				for (const { uploadState } of attachedFiles) {
					if (uploadState.status === 'success' && uploadState.fileId) {
						fileIds.push(uploadState.fileId);
					}
				}

				try {
					threadContext.setAwaitingStream(true);
					await threadContext.sendMessage(client, prompt, {
						fileIds: fileIds.length > 0 ? fileIds : undefined,
						attachments: allAttachments
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
					threadContext.setAwaitingStream(false);
				}
			}}
		/>
	</ChatRoot>
</div>
