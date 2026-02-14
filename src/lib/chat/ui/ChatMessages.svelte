<script lang="ts">
	import type { Snippet } from 'svelte';
	import { getTranslate } from '@tolgee/svelte';
	import {
		ChatContainerRoot,
		ChatContainerContent,
		ChatContainerScrollAnchor,
		ChatContainerContext
	} from '$lib/components/prompt-kit/chat-container';
	import { ScrollButton } from '$lib/components/prompt-kit/scroll-button';
	import ProgressiveBlur from '$blocks/magic/ProgressiveBlur.svelte';
	import { getChatUIContext } from './ChatContext.svelte.js';
	import ChatMessage from './ChatMessage.svelte';
	import type { DisplayMessage, Attachment } from '../core/types.js';

	/**
	 * File metadata for dimension lookup
	 * Map of URL -> { width, height }
	 */
	type FileMetadataMap = Record<string, { width?: number; height?: number }>;

	const { t } = getTranslate();

	let {
		emptyState,
		extractAttachments,
		fileMetadata = {},
		showEmailPrompt = false,
		currentEmail = '',
		isEmailPending = false,
		defaultEmail = '',
		onSubmitEmail,
		class: className = ''
	}: {
		/** Custom empty state content */
		emptyState?: Snippet;
		/** Function to extract attachments from a message */
		extractAttachments?: (message: DisplayMessage, metadata?: FileMetadataMap) => Attachment[];
		/** File metadata for dimension lookup (URL -> dimensions) */
		fileMetadata?: FileMetadataMap;
		/** Whether to show email prompt in handoff message */
		showEmailPrompt?: boolean;
		/** Currently saved notification email */
		currentEmail?: string;
		/** True while email mutation is in flight (green check hidden until confirmed) */
		isEmailPending?: boolean;
		/** Default email (from logged-in user) */
		defaultEmail?: string;
		/** Callback when email is submitted */
		onSubmitEmail?: (email: string) => Promise<void>;
		/** Additional CSS classes */
		class?: string;
	} = $props();

	const ctx = getChatUIContext();
	const chatCtx = new ChatContainerContext();

	// Resolve the actual background color from the nearest ancestor for the bottom gradient
	let wrapperEl: HTMLDivElement | undefined = $state();
	let resolvedBg = $state('');

	$effect(() => {
		if (!wrapperEl) return;
		// Walk up to find the first ancestor with a non-transparent background
		let el: HTMLElement | null = wrapperEl;
		while (el) {
			const bg = getComputedStyle(el).backgroundColor;
			if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') {
				resolvedBg = bg;
				return;
			}
			el = el.parentElement;
		}
	});

	// Handoff message text to detect - use the same translation as backend
	const HANDOFF_MESSAGE = $derived($t('backend.support.handoff.response').split('.')[0] + '.');

	/**
	 * Get the "sender type" for a message to determine grouping
	 * Returns: 'user' | 'admin' | 'ai'
	 */
	function getSenderType(message: DisplayMessage): 'user' | 'admin' | 'ai' {
		if (message.role === 'user') return 'user';
		if (message.metadata?.provider === 'human') return 'admin';
		return 'ai';
	}

	/**
	 * Check if a message is the first in its group (different sender than previous)
	 */
	function isFirstInGroup(index: number, messages: DisplayMessage[]): boolean {
		if (index === 0) return true;
		const currentSender = getSenderType(messages[index]);
		const previousSender = getSenderType(messages[index - 1]);
		return currentSender !== previousSender;
	}

	// Default attachment extraction if not provided
	function defaultExtractAttachments(
		msg: DisplayMessage,
		metadata?: FileMetadataMap
	): Attachment[] {
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

						// Get dimensions from metadata (keyed by URL since UIMessage parts don't have fileId)
						const dims = metadata?.[url];

						if (isImage) {
							attachments.push({
								type: 'image' as const,
								url: url,
								filename: part.filename || $t('chat.attachment.image_fallback'),
								width: dims?.width ?? part.width,
								height: dims?.height ?? part.height
							});
						} else {
							attachments.push({
								type: 'remote-file' as const,
								url: url,
								filename: part.filename || $t('chat.attachment.file_fallback'),
								contentType: part.mediaType || part.mimeType,
								width: dims?.width ?? part.width,
								height: dims?.height ?? part.height
							});
						}
					}
				}
			}
		}

		return attachments;
	}

	let getAttachments = $derived(
		extractAttachments
			? (msg: DisplayMessage) => extractAttachments(msg, fileMetadata)
			: (msg: DisplayMessage) => defaultExtractAttachments(msg, fileMetadata)
	);
</script>

<div bind:this={wrapperEl} class="relative h-full {className}">
	<ChatContainerRoot ctx={chatCtx} class="h-full">
		<ChatContainerContent class="!h-full">
			{#if ctx.displayMessages.length === 0}
				<!-- Empty state -->
				{#if emptyState}
					{@render emptyState()}
				{/if}
			{:else}
				<!-- Messages list with fade-in animation on first load -->
				<div class="px-9 py-20 {ctx.messagesFade.animationClass}">
					{#each ctx.displayMessages as message, index (message.id)}
						<ChatMessage
							{message}
							attachments={getAttachments(message)}
							isFirstInGroup={isFirstInGroup(index, ctx.displayMessages)}
							isHandoffMessage={message.displayText?.startsWith(HANDOFF_MESSAGE)}
							{showEmailPrompt}
							{currentEmail}
							{isEmailPending}
							{defaultEmail}
							{onSubmitEmail}
						/>
					{/each}
				</div>
			{/if}

			<!-- Scroll anchor for auto-scroll functionality -->
			<ChatContainerScrollAnchor />
		</ChatContainerContent>
	</ChatContainerRoot>

	<!-- Scroll button pinned to bottom overlay, outside scroll container -->
	<div class="pointer-events-none absolute inset-x-0 bottom-0 z-20 h-16 w-full">
		<ScrollButton
			class="pointer-events-auto absolute right-9 bottom-6 z-20"
			isAtBottom={chatCtx.isAtBottom}
			onScrollToBottom={() => chatCtx.scrollToBottom()}
		/>
	</div>

	<!-- Blur pinned to chat viewport bottom, inset to avoid the scrollbar -->
	{#if ctx.displayMessages.length > 0}
		<div
			class="pointer-events-none absolute bottom-0 left-0 z-10"
			style="right: var(--scrollbar-w, 0px); height: 5rem;"
		>
			<ProgressiveBlur class="absolute inset-0" direction="bottom" blurIntensity={1} />
			<!-- Gradient overlay: fades from transparent to parent background over the tucked-under portion -->
			{#if resolvedBg}
				<div
					class="absolute inset-x-0 bottom-0 h-4"
					style="background: linear-gradient(to bottom, transparent, {resolvedBg});"
				></div>
			{/if}
		</div>
	{/if}
</div>
