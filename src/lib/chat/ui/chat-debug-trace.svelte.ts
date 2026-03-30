import type { UIMessage } from '@convex-dev/agent';
import type { StreamDelta, StreamMessage } from '@convex-dev/agent/validators';
import { untrack } from 'svelte';
import { SvelteMap } from 'svelte/reactivity';
import type { ChatMessage, DisplayMessage, MessagePart } from '../core/types.js';
import { getActiveStreamingReasoningIndex, getReasoningPartKey } from './reasoning-parts.js';
import type { ChatUIContext } from './ChatContext.svelte.js';

const MAX_TRACE_EVENTS = 250;

export type ChatTraceStage =
	| 'messages-query'
	| 'stream-deltas'
	| 'decoded-streams'
	| 'display-messages'
	| 'accordion-before'
	| 'accordion-after'
	| 'render-message'
	| 'decode-error';

export interface ChatTraceEvent {
	seq: number;
	ts: number;
	stage: ChatTraceStage;
	scope: string;
	threadId: string | null;
	payload: unknown;
}

declare global {
	interface Window {
		__chatTrace?: ChatDebugTrace;
	}
}

function summarizeTextPart(part: MessagePart, index: number) {
	const text = (part as { text?: unknown }).text;
	return {
		kind: 'text',
		key: `text-${index}`,
		textLength: typeof text === 'string' ? text.length : 0
	};
}

function summarizeReasoningPart(part: MessagePart, index: number) {
	const text = (part as { text?: unknown }).text;
	return {
		kind: 'reasoning',
		key: getReasoningPartKey(part, index),
		textLength: typeof text === 'string' ? text.length : 0,
		state: (part as { state?: unknown }).state ?? 'unknown'
	};
}

function summarizeToolPart(part: MessagePart, index: number) {
	return {
		kind: 'tool',
		key: ((part as { toolCallId?: unknown }).toolCallId as string | undefined) ?? `tool-${index}`,
		type: part.type,
		state: (part as { state?: unknown }).state ?? 'unknown'
	};
}

export function summarizeMessagePart(part: MessagePart, index: number) {
	if (part.type === 'reasoning') return summarizeReasoningPart(part, index);
	if (part.type === 'text') return summarizeTextPart(part, index);
	if (typeof part.type === 'string' && part.type.startsWith('tool-')) {
		return summarizeToolPart(part, index);
	}

	return {
		kind: 'other',
		key: `${part.type}-${index}`,
		type: part.type
	};
}

export function summarizeChatMessage(message: ChatMessage | DisplayMessage | UIMessage) {
	return {
		id: message.id,
		order: message.order,
		stepOrder: 'stepOrder' in message ? (message.stepOrder ?? 0) : 0,
		role: message.role,
		status: message.status,
		textLength: message.text?.length ?? 0,
		displayTextLength:
			'displayText' in message && typeof message.displayText === 'string'
				? message.displayText.length
				: undefined,
		displayReasoningLength:
			'displayReasoning' in message && typeof message.displayReasoning === 'string'
				? message.displayReasoning.length
				: undefined,
		parts: (message.parts ?? []).map((part, index) =>
			summarizeMessagePart(part as MessagePart, index)
		)
	};
}

export function summarizeStreamMessage(streamMessage: StreamMessage) {
	return {
		streamId: streamMessage.streamId,
		order: streamMessage.order,
		stepOrder: streamMessage.stepOrder,
		status: streamMessage.status,
		format: streamMessage.format
	};
}

export function summarizeStreamDelta(delta: StreamDelta) {
	return {
		streamId: delta.streamId,
		start: delta.start,
		end: delta.end,
		parts: delta.parts.map((part) => {
			const record = part as Record<string, unknown>;
			return {
				type: String(record.type ?? 'unknown'),
				id:
					(typeof record.id === 'string' && record.id) ||
					(typeof record.toolCallId === 'string' && record.toolCallId) ||
					undefined
			};
		})
	};
}

export function summarizeAccordionState(messages: DisplayMessage[], ctx: ChatUIContext) {
	const openKeys = Array.from(ctx.reasoningOpenState.entries())
		.filter(([, isOpen]) => isOpen)
		.map(([key]) => key)
		.sort();
	const autoOpenedKeys = Array.from(ctx.autoOpenedMessages).sort();

	return {
		openKeys,
		autoOpenedKeys,
		messages: messages
			.filter((message) => (message.parts ?? []).some((part) => part.type === 'reasoning'))
			.map((message) => {
				const parts = message.parts ?? [];
				const activeReasoningIndex = getActiveStreamingReasoningIndex(
					parts,
					message.status === 'pending' || message.status === 'streaming'
				);

				return {
					id: message.id,
					order: message.order,
					status: message.status,
					activeReasoningKey:
						activeReasoningIndex >= 0
							? `${message.id}:${getReasoningPartKey(parts[activeReasoningIndex]!, activeReasoningIndex)}`
							: null,
					reasoningKeys: parts
						.map((part, index) =>
							part.type === 'reasoning' ? `${message.id}:${getReasoningPartKey(part, index)}` : null
						)
						.filter((key): key is string => key !== null)
				};
			})
	};
}

export function summarizeOrderedParts(
	messageId: string,
	status: string,
	orderedParts: Array<{
		kind: 'reasoning' | 'tool' | 'text';
		key: string;
		isStreaming?: boolean;
		hasContent?: boolean;
		text?: string;
		toolPart?: { type: string; state?: string };
	}>,
	openReasoningKeys: string[]
) {
	return {
		messageId,
		status,
		openReasoningKeys,
		orderedParts: orderedParts.map((part) => {
			if (part.kind === 'reasoning') {
				return {
					kind: 'reasoning',
					key: part.key,
					isStreaming: part.isStreaming ?? false,
					hasContent: part.hasContent ?? false,
					textLength: part.text?.length ?? 0
				};
			}
			if (part.kind === 'tool') {
				return {
					kind: 'tool',
					key: part.key,
					type: part.toolPart?.type,
					state: part.toolPart?.state ?? 'unknown'
				};
			}
			return {
				kind: 'text',
				key: part.key,
				textLength: part.text?.length ?? 0
			};
		})
	};
}

export class ChatDebugTrace {
	events = $state<ChatTraceEvent[]>([]);
	collapsed = $state(true);

	private nextSeq = 1;
	private lastPayloadByKey = new SvelteMap<string, string>();

	recordSnapshot(stage: ChatTraceStage, scope: string, threadId: string | null, payload: unknown) {
		untrack(() => {
			const dedupeKey = `${stage}:${scope}`;
			const serialized = JSON.stringify(payload);
			if (this.lastPayloadByKey.get(dedupeKey) === serialized) {
				return;
			}

			this.lastPayloadByKey.set(dedupeKey, serialized);
			this.pushEvent(stage, scope, threadId, payload);
		});
	}

	record(stage: ChatTraceStage, scope: string, threadId: string | null, payload: unknown) {
		untrack(() => {
			this.pushEvent(stage, scope, threadId, payload);
		});
	}

	clear() {
		untrack(() => {
			this.events = [];
			this.lastPayloadByKey.clear();
			this.nextSeq = 1;
		});
	}

	exportJson() {
		return JSON.stringify(this.events, null, 2);
	}

	attachToWindow() {
		if (typeof window !== 'undefined') {
			window.__chatTrace = this;
		}
	}

	detachFromWindow() {
		if (typeof window !== 'undefined' && window.__chatTrace === this) {
			delete window.__chatTrace;
		}
	}

	private pushEvent(
		stage: ChatTraceStage,
		scope: string,
		threadId: string | null,
		payload: unknown
	) {
		untrack(() => {
			const event: ChatTraceEvent = {
				seq: this.nextSeq++,
				ts: Date.now(),
				stage,
				scope,
				threadId,
				payload
			};

			const nextEvents =
				this.events.length >= MAX_TRACE_EVENTS
					? [...this.events.slice(-(MAX_TRACE_EVENTS - 1)), event]
					: [...this.events, event];
			this.events = nextEvents;
		});
	}
}

export function getLatestTraceEvents(events: ChatTraceEvent[]) {
	const latestByKey = new SvelteMap<string, ChatTraceEvent>();

	for (const event of events) {
		latestByKey.set(`${event.stage}:${event.scope}`, event);
	}

	return Array.from(latestByKey.values()).sort((a, b) => b.seq - a.seq);
}
