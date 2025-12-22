<script lang="ts">
	import { Message, MessageContent } from '$lib/components/prompt-kit/message';
	import { Response } from '$lib/components/ai-elements/response';
	import ChatAttachments from './ChatAttachments.svelte';
	import ChatReasoning from './ChatReasoning.svelte';
	import { ToolComposed } from '$lib/components/customer-support/ticket-tool';
	import type {
		ToolPart,
		TicketSubmitData
	} from '$lib/components/customer-support/ticket-tool/types.js';
	import { getChatUIContext } from './ChatContext.svelte.js';
	import {
		type DisplayMessage,
		type Attachment,
		type ToolCallPart,
		type MessagePart
	} from '../core/types.js';
	import { useConvexClient, useQuery } from 'convex-svelte';
	import { api } from '$lib/convex/_generated/api';

	let {
		message,
		attachments = [],
		threadId
	}: {
		/** The message to display */
		message: DisplayMessage;
		/** Extracted attachments for this message */
		attachments?: Attachment[];
		/** Thread ID for ticket form */
		threadId?: string;
	} = $props();

	const ctx = getChatUIContext();
	const client = useConvexClient();

	const isUser = $derived(message.role === 'user');
	const isReasoningOpen = $derived(ctx.isReasoningOpen(message.id));

	// Check if this message has any tool calls
	const hasToolCalls = $derived(message.parts?.some((p) => p.type.startsWith('tool-')) ?? false);

	// Find the user message that prompted this assistant response (needed for HITL continuation)
	const promptMessageId = $derived.by(() => {
		if (!hasToolCalls) return undefined;

		const messages = ctx.displayMessages;
		const currentIndex = messages.findIndex((m) => m.id === message.id);

		if (currentIndex <= 0) return undefined;

		for (let i = currentIndex - 1; i >= 0; i--) {
			if (messages[i].role === 'user') {
				return messages[i].id;
			}
		}
		return undefined;
	});

	// Track tool calls that have been submitted (form submitted, waiting for email delivery)
	let submittedToolCallIds = $state(new Set<string>());

	// Query args for ticket delivery status - only when we have submitted tool calls
	const ticketStatusArgs = $derived.by((): { threadId: string; toolCallId: string } | null => {
		if (!hasToolCalls || !threadId) return null;

		// Find tool calls that have been submitted but don't have output yet
		const pendingToolCalls = (message.parts ?? [])
			.filter(
				(p): p is MessagePart & { type: 'tool-submitSupportTicket' } =>
					p.type === 'tool-submitSupportTicket'
			)
			.map((p) => p as unknown as ToolCallPart)
			.filter((p) => !p.output && submittedToolCallIds.has(p.toolCallId));

		if (pendingToolCalls.length === 0) return null;

		// Subscribe for the first pending tool call
		return {
			threadId,
			toolCallId: pendingToolCalls[0].toolCallId
		};
	});

	// Subscribe to ticket delivery status for submitted tool calls
	// Always provide valid args - query returns 'not_found' when toolCallId doesn't match
	const ticketStatusQuery = useQuery(
		api.support.ticketHelpers.getTicketDeliveryStatus,
		() => ticketStatusArgs ?? { threadId: threadId ?? '', toolCallId: '' }
	);

	// Current ticket delivery status (from database)
	const pendingTicketStatus = $derived(ticketStatusQuery.data);

	// Build ToolPart data from a raw tool call part
	function buildToolPartData(toolCallPart: ToolCallPart): ToolPart {
		let output: Record<string, unknown> | undefined;
		if (toolCallPart.output) {
			try {
				output =
					typeof toolCallPart.output === 'string'
						? JSON.parse(toolCallPart.output)
						: (toolCallPart.output as Record<string, unknown>);
			} catch {
				/* ignore parse errors */
			}
		}

		// Determine state based on output or pending ticket status
		let state: ToolPart['state'] = (toolCallPart.state as ToolPart['state']) ?? 'input-available';
		let errorText: string | undefined;

		if (output?.status === 'submitted') {
			// Tool result received - email delivered successfully
			state = 'output-available';
		} else if (output?.status === 'canceled') {
			// Tool result received - user canceled
			state = 'output-error';
			// Don't set errorText - UI uses absence of errorText to show canceled styling
		} else if (output?.status === 'error') {
			// Tool result received - backend error
			state = 'output-error';
			errorText = output?.message as string;
		} else if (submittedToolCallIds.has(toolCallPart.toolCallId)) {
			// Form submitted, waiting for email delivery - check ticket status
			const isThisToolCall = ticketStatusArgs?.toolCallId === toolCallPart.toolCallId;
			const ticketStatus = isThisToolCall ? pendingTicketStatus : undefined;

			if (ticketStatus && ticketStatus.status !== 'not_found') {
				if (ticketStatus.status === 'failed') {
					// Email delivery failed
					state = 'output-error';
					errorText = ticketStatus.error || 'Failed to submit ticket. Please try again.';
				} else {
					// Pending or delivered (waiting for tool-result to be saved)
					state = 'output-processing';
				}
			} else {
				// Ticket not found yet - still processing
				state = 'output-processing';
			}
		}

		return {
			type: 'submitSupportTicket',
			state,
			toolCallId: toolCallPart.toolCallId,
			title: (toolCallPart.input?.title as string) ?? '',
			description: (toolCallPart.input?.description as string) ?? '',
			ticketType: toolCallPart.input?.ticketType as
				| 'bug_report'
				| 'feature_request'
				| 'general_inquiry',
			includeAttachments: (toolCallPart.input?.includeAttachments as boolean) ?? true,
			errorText
		};
	}

	async function handleTicketSubmit(toolCallPart: ToolCallPart, data: TicketSubmitData) {
		if (!threadId || !promptMessageId) return;

		// Mark this tool call as submitted (triggers processing state)
		submittedToolCallIds = new Set([...submittedToolCallIds, toolCallPart.toolCallId]);

		await client.mutation(api.support.ticketHelpers.submitTicketToolResult, {
			threadId,
			toolCallId: toolCallPart.toolCallId,
			promptMessageId,
			action: 'submitted',
			ticketType: data.ticketType,
			title: data.title,
			description: data.description,
			email: data.email,
			includeAttachments: (toolCallPart.input?.includeAttachments as boolean) ?? true
		});
	}

	async function handleTicketCancel(toolCallPart: ToolCallPart) {
		if (!threadId || !promptMessageId) return;

		await client.mutation(api.support.ticketHelpers.submitTicketToolResult, {
			threadId,
			toolCallId: toolCallPart.toolCallId,
			promptMessageId,
			action: 'canceled'
		});
	}

	// Build ordered parts for rendering assistant messages
	type RenderPart =
		| { kind: 'text'; content: string }
		| { kind: 'reasoning'; content: string }
		| { kind: 'tool-submitSupportTicket'; toolCallPart: ToolCallPart };

	const orderedParts = $derived.by((): RenderPart[] => {
		if (isUser) return [];

		// If no parts array, create synthetic text part from displayText
		if (!message.parts?.length) {
			if (message.displayText) {
				return [{ kind: 'text', content: message.displayText }];
			}
			return [];
		}

		// If no tool calls, use the simpler displayText approach
		// This handles streaming better since displayText has the latest content
		if (!hasToolCalls) {
			const parts: RenderPart[] = [];
			if (message.displayReasoning) {
				parts.push({ kind: 'reasoning', content: message.displayReasoning });
			}
			if (message.displayText) {
				parts.push({ kind: 'text', content: message.displayText });
			}
			return parts;
		}

		// Has tool calls - iterate through parts in order
		const parts: RenderPart[] = [];

		for (const part of message.parts) {
			if (part.type === 'text') {
				const textPart = part as { type: 'text'; text: string };
				if (textPart.text) {
					parts.push({ kind: 'text', content: textPart.text });
				}
			} else if (part.type === 'reasoning') {
				const reasoningPart = part as { type: 'reasoning'; reasoning: string };
				if (reasoningPart.reasoning) {
					parts.push({ kind: 'reasoning', content: reasoningPart.reasoning });
				}
			} else if (part.type === 'tool-submitSupportTicket') {
				parts.push({
					kind: 'tool-submitSupportTicket',
					toolCallPart: part as unknown as ToolCallPart
				});
			}
			// Other tool types could be handled here in the future
		}

		return parts;
	});

	// For non-tool messages, determine if we should show reasoning section
	const showReasoning = $derived(
		!hasToolCalls &&
			(message.displayReasoning ||
				message.hasReasoningStream ||
				(message.status === 'pending' && !message.displayText))
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
			<ChatAttachments {attachments} readonly={true} columns={2} class="px-0" />
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
		{:else if hasToolCalls && threadId}
			<!-- Message with tool calls - render parts in order -->
			{#each orderedParts as part, index (index)}
				{#if part.kind === 'text'}
					<MessageContent class="prose w-full flex-1 p-0 pr-5">
						<Response content={part.content} animation={{ enabled: true }} />
					</MessageContent>
				{:else if part.kind === 'reasoning'}
					<MessageContent class="prose w-full flex-1 p-0 pr-5">
						<ChatReasoning
							open={isReasoningOpen}
							onOpenChange={handleReasoningOpenChange}
							isStreaming={false}
							hasContent={true}
							content={part.content}
						/>
					</MessageContent>
				{:else if part.kind === 'tool-submitSupportTicket'}
					<MessageContent class="w-full p-0 pr-5">
						<ToolComposed
							toolPart={buildToolPartData(part.toolCallPart)}
							{threadId}
							defaultOpen={true}
							onticketsubmit={(data) => handleTicketSubmit(part.toolCallPart, data)}
							onticketcancel={() => handleTicketCancel(part.toolCallPart)}
						/>
					</MessageContent>
				{/if}
			{/each}
		{:else}
			<!-- Regular assistant message without tool calls -->
			<MessageContent class="prose w-full flex-1 p-0 pr-5">
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
