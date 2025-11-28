<script lang="ts">
	import { Message, MessageContent } from '$lib/components/prompt-kit/message';
	import { Response } from '$lib/components/ai-elements/response';
	import Attachments from '$lib/components/customer-support/attachments.svelte';
	import ChatReasoning from './ChatReasoning.svelte';
	import { getChatUIContext } from './ChatContext.svelte.js';
	import type { DisplayMessage, Attachment } from '../core/types.js';

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
	const isReasoningOpen = $derived(ctx.isReasoningOpen(message.id));

	// Determine if we should show reasoning section
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

<div class="flex w-full flex-col gap-1 {isUser ? 'items-end' : 'items-start'}">
	{#if attachments.length > 0}
		<div class="max-w-[85%] md:max-w-[75%]">
			<Attachments {attachments} readonly={true} columns={2} class="px-0" />
		</div>
	{/if}
	<Message class="flex w-full flex-col gap-2 {isUser ? 'items-end' : 'items-start'}">
		{#if isUser}
			<MessageContent
				class="max-w-[85%] bg-primary/15 px-5 py-2.5 text-foreground md:max-w-[75%] {attachments.length >
				0
					? 'rounded-3xl rounded-tr-lg'
					: 'rounded-3xl'}"
			>
				{message.displayText}
			</MessageContent>
		{:else}
			<MessageContent class="prose w-full flex-1 p-0 pr-4 ">
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
			</MessageContent>
		{/if}
	</Message>
</div>
