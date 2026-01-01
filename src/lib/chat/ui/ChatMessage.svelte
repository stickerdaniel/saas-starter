<script lang="ts">
	import { Message } from '$lib/components/prompt-kit/message';
	import { Response } from '$lib/components/ai-elements/response';
	import ChatAttachments from './ChatAttachments.svelte';
	import ChatReasoning from './ChatReasoning.svelte';
	import MessageBubble from './MessageBubble.svelte';
	import { getChatUIContext } from './ChatContext.svelte.js';
	import { type DisplayMessage, type Attachment } from '../core/types.js';

	let {
		message,
		attachments = []
	}: {
		/** The message to display */
		message: DisplayMessage;
		/** Extracted attachments for this message */
		attachments?: Attachment[];
	} = $props();

	const ctx = getChatUIContext();

	const isUser = $derived(message.role === 'user');
	const align = $derived(ctx.getAlignment(message.role));
	const isReasoningOpen = $derived(ctx.isReasoningOpen(message.id));

	// For assistant messages, determine if we should show reasoning section
	const showReasoning = $derived(
		message.displayReasoning ||
			message.hasReasoningStream ||
			(message.status === 'pending' && !message.displayText)
	);

	// Whether to use shimmer effect
	const shouldUseShimmer = $derived(!!message.displayReasoning && !message.displayText);

	// Whether we have reasoning content
	const hasReasoningContent = $derived(!!message.displayReasoning);

	function handleReasoningOpenChange(open: boolean) {
		ctx.setReasoningOpen(message.id, open);
	}
</script>

<div class="flex w-full flex-col gap-1 {align === 'right' ? 'items-end' : 'items-start'}">
	{#if attachments.length > 0}
		<div class="max-w-[85%] md:max-w-[75%]">
			<ChatAttachments {attachments} readonly={true} columns={2} {align} class="px-0" />
		</div>
	{/if}
	<Message class="flex w-full flex-col gap-2 {align === 'right' ? 'items-end' : 'items-start'}">
		{#if isUser}
			<MessageBubble {align} variant="filled" hasTopAttachment={attachments.length > 0}>
				{message.displayText}
			</MessageBubble>
		{:else}
			<MessageBubble {align} variant="ghost">
				{#if showReasoning}
					<ChatReasoning
						open={isReasoningOpen}
						onOpenChange={handleReasoningOpenChange}
						isStreaming={shouldUseShimmer}
						hasContent={hasReasoningContent}
						content={message.displayReasoning}
					/>
				{/if}
				{#if message.displayText}
					<Response content={message.displayText} animation={{ enabled: true }} />
				{/if}
			</MessageBubble>
		{/if}
	</Message>
</div>
