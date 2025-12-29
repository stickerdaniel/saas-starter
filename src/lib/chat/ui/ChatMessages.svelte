<script lang="ts">
	import type { Snippet } from 'svelte';
	import {
		ChatContainerRoot,
		ChatContainerContent,
		ChatContainerScrollAnchor
	} from '$lib/components/prompt-kit/chat-container';
	import { ScrollButton } from '$lib/components/prompt-kit/scroll-button';
	import ProgressiveBlur from '$blocks/magic/ProgressiveBlur.svelte';
	import { getChatUIContext } from './ChatContext.svelte.js';
	import ChatMessage from './ChatMessage.svelte';
	import type { DisplayMessage, Attachment } from '../core/types.js';

	let {
		emptyState,
		extractAttachments,
		class: className = ''
	}: {
		/** Custom empty state content */
		emptyState?: Snippet;
		/** Function to extract attachments from a message */
		extractAttachments?: (message: DisplayMessage) => Attachment[];
		/** Additional CSS classes */
		class?: string;
	} = $props();

	const ctx = getChatUIContext();

	// Default attachment extraction if not provided
	function defaultExtractAttachments(msg: DisplayMessage): Attachment[] {
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

	const getAttachments = extractAttachments || defaultExtractAttachments;
</script>

<ChatContainerRoot class="relative h-full {className}">
	<ChatContainerContent class="!h-full">
		{#if ctx.displayMessages.length === 0}
			<!-- Empty state -->
			{#if emptyState}
				{@render emptyState()}
			{/if}
		{:else}
			<!-- Messages list with fade-in animation on first load -->
			<div class="space-y-4 py-20 pr-4 pl-9 {ctx.messagesFade.animationClass}">
				{#each ctx.displayMessages as message (message._renderKey ?? message.id)}
					<ChatMessage {message} attachments={getAttachments(message)} />
				{/each}
			</div>
		{/if}

		<!-- Scroll anchor for auto-scroll functionality -->
		<ChatContainerScrollAnchor />

		<!-- Overlay area pinned to bottom of scroll container -->
		<div class="pointer-events-none relative sticky bottom-0 z-10 min-h-16 w-full">
			<!-- Progressive blur as background overlay - only shown when there are messages -->
			{#if ctx.displayMessages.length > 0}
				<ProgressiveBlur
					class="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-20 w-full"
					direction="bottom"
					blurIntensity={1}
				/>
			{/if}
			<!-- Scroll button over the blur -->
			<ScrollButton class="pointer-events-auto absolute right-9 bottom-6 z-20" />
		</div>
	</ChatContainerContent>
</ChatContainerRoot>
