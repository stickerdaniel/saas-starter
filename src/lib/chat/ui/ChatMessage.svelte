<script lang="ts">
	import { Message } from '$lib/components/prompt-kit/message';
	import { Response } from '$lib/components/ai-elements/response';
	import { ToolComposed } from '$lib/components/prompt-kit/tool';
	import type { ToolPart } from '$lib/components/prompt-kit/tool/types.js';
	import ChatAttachments from './ChatAttachments.svelte';
	import ChatReasoning from './ChatReasoning.svelte';
	import MessageBubble from './MessageBubble.svelte';
	import InlineEmailPrompt from './InlineEmailPrompt.svelte';
	import { getChatUIContext } from './ChatContext.svelte.js';
	import { getActiveStreamingReasoningIndex, getReasoningPartKey } from './reasoning-parts.js';
	import { type DisplayMessage, type Attachment } from '../core/types.js';

	let {
		message,
		attachments = [],
		isFirstInGroup = true,
		isHandoffMessage = false,
		showEmailPrompt = false,
		currentEmail = '',
		isEmailPending = false,
		defaultEmail = '',
		onSubmitEmail
	}: {
		/** The message to display */
		message: DisplayMessage;
		/** Extracted attachments for this message */
		attachments?: Attachment[];
		/** Whether this is the first message in a group (different sender than previous) */
		isFirstInGroup?: boolean;
		/** Whether this is the handoff confirmation message */
		isHandoffMessage?: boolean;
		/** Whether to show email prompt (handed off) */
		showEmailPrompt?: boolean;
		/** Currently saved notification email */
		currentEmail?: string;
		/** True while email mutation is in flight (green check hidden until confirmed) */
		isEmailPending?: boolean;
		/** Default email (from logged-in user) */
		defaultEmail?: string;
		/** Callback when email is submitted */
		onSubmitEmail?: (email: string) => Promise<void>;
	} = $props();

	const ctx = getChatUIContext();

	const isUser = $derived(message.role === 'user');
	const isAdminMessage = $derived(
		message.metadata?.provider === 'human' ||
			(message.metadata?.providerMetadata as { admin?: { isAdminMessage?: boolean } })?.admin
				?.isAdminMessage === true
	);
	const align = $derived(ctx.getAlignment(message.role));
	function isReasoningPartOpen(partKey: string): boolean {
		return ctx.isReasoningOpen(`${message.id}:${partKey}`);
	}

	function handleReasoningPartOpenChange(partKey: string, open: boolean) {
		ctx.setReasoningOpen(`${message.id}:${partKey}`, open);
	}

	// Fallback: single reasoning open state for messages without parts
	const isReasoningOpen = $derived(ctx.isReasoningOpen(message.id));

	// Whether this message has interleaved parts (reasoning/tool/text in order)
	const hasParts = $derived(!!(message.parts && message.parts.length > 0));

	// Fallback deriveds for messages without parts (pending state, old messages)
	const showReasoningFallback = $derived(
		message.displayReasoning ||
			message.hasReasoningStream ||
			(message.status === 'pending' && !message.displayText)
	);
	const shimmerFallback = $derived(!!message.displayReasoning && !message.displayText);

	type OrderedPart =
		| { kind: 'reasoning'; text: string; isStreaming: boolean; hasContent: boolean; key: string }
		| { kind: 'tool'; toolPart: ToolPart; key: string }
		| { kind: 'text'; text: string; key: string };

	// Derive ordered parts for chronological rendering
	const orderedParts: OrderedPart[] = $derived.by(() => {
		const parts = message.parts ?? [];
		const isMessageInProgress = message.status === 'pending' || message.status === 'streaming';
		const activeReasoningIndex = getActiveStreamingReasoningIndex(parts, isMessageInProgress);
		return parts
			.map((p, idx): OrderedPart | null => {
				if (p.type === 'reasoning') {
					const text = (p as { text?: string }).text ?? '';
					return {
						kind: 'reasoning',
						text,
						isStreaming: idx === activeReasoningIndex,
						hasContent: !!text,
						key: getReasoningPartKey(idx)
					};
				}
				if (p.type === 'text') {
					return {
						kind: 'text',
						text: (p as { text?: string }).text ?? '',
						key: `text-${idx}`
					};
				}
				if (typeof p.type === 'string' && p.type.startsWith('tool-') && 'state' in p) {
					return {
						kind: 'tool',
						toolPart: {
							type: p.type,
							state: (p as { state: ToolPart['state'] }).state,
							input: (p as { input?: Record<string, unknown> }).input,
							output: (p as { output?: unknown }).output as Record<string, unknown> | undefined,
							toolCallId: (p as { toolCallId?: string }).toolCallId,
							errorText: (p as { errorText?: string }).errorText
						},
						key:
							(p as { toolCallId?: string }).toolCallId ??
							(p as { streamId?: string }).streamId ??
							`tool-${idx}`
					};
				}
				return null;
			})
			.filter((p): p is OrderedPart => p !== null);
	});

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
			<MessageBubble {align} variant="filled" hasTopAttachment={attachments.length > 0}>
				{message.displayText}
			</MessageBubble>
		{:else}
			<!-- AI messages: ghost/prose style with interleaved reasoning/tools/text -->
			<MessageBubble {align} variant="ghost">
				{#if hasParts}
					{#each orderedParts as part (part.key)}
						{#if part.kind === 'reasoning'}
							<ChatReasoning
								open={isReasoningPartOpen(part.key)}
								onOpenChange={(open) => handleReasoningPartOpenChange(part.key, open)}
								isStreaming={part.isStreaming}
								hasContent={part.hasContent}
								content={part.text}
							/>
						{:else if part.kind === 'tool'}
							<ToolComposed toolPart={part.toolPart} />
						{:else if part.kind === 'text'}
							<Response content={part.text} animation={{ enabled: true }} />
						{/if}
					{/each}
				{:else}
					<!-- Fallback for messages without parts (pending, old messages) -->
					{#if showReasoningFallback}
						<ChatReasoning
							open={isReasoningOpen}
							onOpenChange={handleReasoningOpenChange}
							isStreaming={shimmerFallback}
							hasContent={!!message.displayReasoning}
							content={message.displayReasoning}
						/>
					{/if}
					{#if message.displayText}
						<Response content={message.displayText} animation={{ enabled: true }} />
					{/if}
				{/if}
				{#if isHandoffMessage && showEmailPrompt && onSubmitEmail}
					<InlineEmailPrompt {currentEmail} {isEmailPending} {defaultEmail} {onSubmitEmail} />
				{/if}
			</MessageBubble>
		{/if}
	</Message>
</div>
