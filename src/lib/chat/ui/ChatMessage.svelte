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
		attachments = [],
		isFirstInGroup = true
	}: {
		/** The message to display */
		message: DisplayMessage;
		/** Extracted attachments for this message */
		attachments?: Attachment[];
		/** Whether this is the first message in a group (different sender than previous) */
		isFirstInGroup?: boolean;
	} = $props();

	const ctx = getChatUIContext();

	const isUser = $derived(message.role === 'user');
	const isAdminMessage = $derived(
		message.metadata?.provider === 'human' ||
			(message.metadata?.providerMetadata as { admin?: { isAdminMessage?: boolean } })?.admin
				?.isAdminMessage === true
	);
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

<div
	class="flex w-full flex-col gap-1 {align === 'right'
		? 'items-end'
		: 'items-start'} {isFirstInGroup ? 'mt-8' : 'mt-1'}"
>
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
		{:else if isAdminMessage}
			<!-- Admin messages: filled bubble style like user messages -->
			<MessageBubble {align} variant="filled">
				{message.displayText}
			</MessageBubble>
		{:else}
			<!-- AI messages: ghost/prose style with reasoning -->
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
