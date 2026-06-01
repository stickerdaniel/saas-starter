<script lang="ts">
	import { Message } from '$lib/components/prompt-kit/message';
	import { Response } from '$lib/components/ai-elements/response';
	import { ToolComposed } from '$lib/components/prompt-kit/tool';
	import ChatAttachments from './ChatAttachments.svelte';
	import ChatReasoning from './ChatReasoning.svelte';
	import MessageBubble from './MessageBubble.svelte';
	import InlineEmailPrompt from './InlineEmailPrompt.svelte';
	import { getChatUIContext } from './ChatContext.svelte.js';
	import { deriveOrderedParts, LEADING_REASONING_KEY, type OrderedPart } from './ordered-parts.js';
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
	const usesFilledBubble = $derived(isUser || isAdminMessage);
	const align = $derived(ctx.getAlignment(message.role));
	function handleReasoningOpenChange(stateKey: string, open: boolean) {
		ctx.setReasoningOpen(stateKey, open);
		ctx.markUserToggled(stateKey);
	}

	// Fallback deriveds for messages without renderable parts (pending state, old messages)
	const showReasoningFallback = $derived(
		message.displayReasoning ||
			message.hasReasoningStream ||
			(message.status === 'pending' && !message.displayText)
	);
	const shimmerFallback = $derived(!!message.displayReasoning && !message.displayText);

	// Renderable parts in chronological order (step-start etc. are dropped)
	const orderedParts = $derived(deriveOrderedParts(message.parts, message.status));

	// Reasoning items carry a resolved accordion open-state key. The leading reasoning and
	// its connecting placeholder share a stable Svelte key (LEADING_REASONING_KEY), so the
	// component instance survives the connecting -> thinking transition without remounting.
	type RenderItem =
		| {
				kind: 'reasoning';
				text: string;
				isStreaming: boolean;
				hasContent: boolean;
				key: string;
				stateKey: string;
		  }
		| Exclude<OrderedPart, { kind: 'reasoning' }>;

	const renderItems: RenderItem[] = $derived.by(() => {
		if (orderedParts.length > 0) {
			return orderedParts.map(
				(part): RenderItem =>
					part.kind === 'reasoning'
						? {
								kind: 'reasoning',
								text: part.text,
								isStreaming: part.isStreaming,
								hasContent: part.hasContent,
								key: part.key,
								stateKey: `${message.id}:${part.key}`
							}
						: part
			);
		}

		// No renderable parts yet: keep a single connecting indicator mounted, plus legacy text.
		const items: RenderItem[] = [];
		if (showReasoningFallback) {
			items.push({
				kind: 'reasoning',
				text: message.displayReasoning,
				isStreaming: shimmerFallback,
				hasContent: !!message.displayReasoning,
				key: LEADING_REASONING_KEY,
				stateKey: `${message.id}:${LEADING_REASONING_KEY}`
			});
		}
		if (message.displayText) {
			items.push({ kind: 'text', text: message.displayText, key: 'text-0' });
		}
		return items;
	});
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
		{#if usesFilledBubble}
			<MessageBubble {align} variant="filled" hasTopAttachment={attachments.length > 0}>
				{message.displayText}
			</MessageBubble>
		{:else}
			<!-- AI messages: ghost/prose style with interleaved reasoning/tools/text -->
			<MessageBubble {align} variant="ghost">
				{#each renderItems as item (item.key)}
					{#if item.kind === 'reasoning'}
						<ChatReasoning
							open={ctx.isReasoningOpen(item.stateKey)}
							onOpenChange={(open) => handleReasoningOpenChange(item.stateKey, open)}
							isStreaming={item.isStreaming}
							hasContent={item.hasContent}
							content={item.text}
						/>
					{:else if item.kind === 'tool'}
						<ToolComposed toolPart={item.toolPart} />
					{:else if item.kind === 'text'}
						<Response content={item.text} animation={{ enabled: true }} />
					{/if}
				{/each}
				{#if isHandoffMessage && showEmailPrompt && onSubmitEmail}
					<InlineEmailPrompt {currentEmail} {isEmailPending} {defaultEmail} {onSubmitEmail} />
				{/if}
			</MessageBubble>
		{/if}
	</Message>
</div>
