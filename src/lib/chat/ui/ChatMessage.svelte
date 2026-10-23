<script lang="ts">
	import type { Snippet } from 'svelte';
	import { Message } from '#lib/components/prompt-kit/message/index.js';
	import { Response, streamingTextAnimation } from '#lib/components/ai-elements/response/index.js';
	import * as Trace from '#lib/components/ui/trace/index.js';
	import ChatAttachments from './ChatAttachments.svelte';
	import ChatReasoning from './ChatReasoning.svelte';
	import ChatTool from './ChatTool.svelte';
	import MessageBubble from './MessageBubble.svelte';
	import InlineEmailPrompt from './InlineEmailPrompt.svelte';
	import { getChatUIContext } from './chat-context.svelte.ts';
	import {
		deriveOrderedParts,
		groupTraces,
		LEADING_REASONING_KEY,
		type OrderedPart
	} from './ordered-parts.js';
	import { type DisplayMessage, type Attachment } from '../core/types.js';
	import { AI_CHAT_LIMIT_NOTICE } from '#lib/convex/constants.js';
	import { getMessageProviderFlags } from '../core/provider-metadata.js';
	import { T } from '@tolgee/svelte';
	import LockIcon from '@lucide/svelte/icons/lock';

	let {
		message,
		attachments = [],
		isFirstInGroup = true,
		isHandoffMessage = false,
		showEmailPrompt = false,
		currentEmail = '',
		isEmailPending = false,
		defaultEmail = '',
		onSubmitEmail,
		messageFooter
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
		/** Rendered below the bubble, inside the column that carries its alignment */
		messageFooter?: Snippet<[DisplayMessage]>;
	} = $props();

	const ctx = getChatUIContext();

	const isUser = $derived(message.role === 'user');
	const providerFlags = $derived(getMessageProviderFlags(message.metadata));
	const isAdminMessage = $derived(providerFlags.isAdminMessage);
	const usesFilledBubble = $derived(isUser || isAdminMessage);
	const align = $derived(ctx.getAlignment(message.role));
	const isLimitNotice = $derived(providerFlags.systemNotice === AI_CHAT_LIMIT_NOTICE);
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

	// The leading reasoning and its connecting placeholder share a stable Svelte key
	// (LEADING_REASONING_KEY), so the component instance survives the connecting -> thinking
	// transition without remounting; `${message.id}:${key}` is its open-state key.
	const renderItems: OrderedPart[] = $derived.by(() => {
		if (orderedParts.length > 0) return orderedParts;

		// No renderable parts yet: keep a single connecting indicator mounted, plus legacy text.
		const items: OrderedPart[] = [];
		if (showReasoningFallback) {
			items.push({
				kind: 'reasoning',
				text: message.displayReasoning,
				isStreaming: shimmerFallback,
				hasContent: !!message.displayReasoning,
				key: LEADING_REASONING_KEY
			});
		}
		if (message.displayText) {
			items.push({
				kind: 'text',
				text: message.displayText,
				isStreaming: message.status === 'pending' || message.status === 'streaming',
				key: 'text-0'
			});
		}
		return items;
	});

	const blocks = $derived(groupTraces(renderItems));
</script>

<div
	class="flex w-full flex-col gap-1 {align === 'right'
		? 'items-end'
		: 'items-start'} {isFirstInGroup ? 'mt-8' : 'mt-1'}"
>
	{#if attachments.length > 0}
		<div class="max-w-17/20 md:max-w-3/4">
			<ChatAttachments {attachments} readonly={true} columns={2} {align} class="px-0" />
		</div>
	{/if}
	<Message class="flex w-full flex-col gap-2 {align === 'right' ? 'items-end' : 'items-start'}">
		{#if usesFilledBubble}
			<MessageBubble {align} variant="filled" hasTopAttachment={attachments.length > 0}>
				{message.displayText}
			</MessageBubble>
		{:else if isLimitNotice}
			<MessageBubble {align} variant="ghost">
				<div class="flex items-center gap-2 text-sm text-muted-foreground">
					<LockIcon class="size-4 shrink-0" aria-hidden="true" />
					<span><T keyName="chat.notices.limit_reached" /></span>
				</div>
			</MessageBubble>
		{:else}
			<!-- AI messages: ghost/prose style with interleaved reasoning/tools/text -->
			<MessageBubble {align} variant="ghost">
				{#each blocks as block (block.key)}
					{#if block.kind === 'trace'}
						<Trace.Root class="not-prose mb-4 text-sm">
							{#each block.items as item (item.key)}
								{#if item.kind === 'reasoning'}
									<ChatReasoning
										open={ctx.isReasoningOpen(`${message.id}:${item.key}`)}
										onOpenChange={(open) =>
											handleReasoningOpenChange(`${message.id}:${item.key}`, open)}
										isStreaming={item.isStreaming}
										hasContent={item.hasContent}
										content={item.text}
									/>
								{:else}
									<ChatTool toolPart={item.toolPart} phase={item.phase} />
								{/if}
							{/each}
						</Trace.Root>
					{:else}
						<Response content={block.text} animation={streamingTextAnimation(block.isStreaming)} />
					{/if}
				{/each}
				{#if isHandoffMessage && showEmailPrompt && onSubmitEmail}
					<InlineEmailPrompt {currentEmail} {isEmailPending} {defaultEmail} {onSubmitEmail} />
				{/if}
			</MessageBubble>
		{/if}
	</Message>
	{#if messageFooter}
		{@render messageFooter(message)}
	{/if}
</div>
