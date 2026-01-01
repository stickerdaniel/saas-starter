/**
 * Stream processing utilities
 *
 * Framework-agnostic delta processing for streaming AI responses.
 * Processes streaming deltas into UIMessages with progressive text and reasoning.
 *
 * Based on @convex-dev/agent deltas processing.
 */

import type { TextStreamPart, ToolSet, ProviderMetadata } from 'ai';
import type { UIMessage } from '@convex-dev/agent';
import type { StreamDelta, StreamMessage, MessageStatus } from '@convex-dev/agent/validators';
import type {
	ChatMessage,
	DisplayMessage,
	MessagePart,
	ReasoningUIPart,
	TextUIPart,
	StreamStatus
} from './types.js';

/**
 * Create a blank UIMessage from stream metadata
 */
export function blankUIMessage<METADATA = unknown>(
	streamMessage: StreamMessage & { metadata?: METADATA },
	threadId: string
): UIMessage<METADATA> {
	return {
		id: `stream:${streamMessage.streamId}`,
		key: `${threadId}-${streamMessage.order}-${streamMessage.stepOrder}`,
		order: streamMessage.order,
		stepOrder: streamMessage.stepOrder,
		status: statusFromStreamStatus(streamMessage.status),
		agentName: streamMessage.agentName,
		text: '',
		_creationTime: Date.now(),
		role: 'assistant',
		parts: [],
		...(streamMessage.metadata ? { metadata: streamMessage.metadata } : {})
	};
}

/**
 * Convert stream status to message status
 */
export function statusFromStreamStatus(
	status: StreamMessage['status']
): MessageStatus | 'streaming' {
	switch (status) {
		case 'streaming':
			return 'streaming';
		case 'finished':
			return 'success';
		case 'aborted':
			return 'failed';
		default:
			return 'pending';
	}
}

/**
 * Get parts from deltas with cursor tracking
 */
export function getParts<T extends StreamDelta['parts'][number]>(
	deltas: StreamDelta[],
	fromCursor?: number
): { parts: T[]; cursor: number } {
	const parts: T[] = [];
	let cursor = fromCursor ?? 0;
	for (const delta of deltas.sort((a, b) => a.start - b.start)) {
		if (delta.parts.length === 0) {
			continue;
		}
		if (cursor !== delta.start) {
			if (cursor >= delta.end) {
				continue;
			} else if (cursor < delta.start) {
				console.warn(
					`Got delta for stream ${delta.streamId} that has a gap ${cursor} -> ${delta.start}`
				);
				break;
			} else {
				throw new Error(
					`Got unexpected delta for stream ${delta.streamId}: delta: ${delta.start} -> ${delta.end} existing cursor: ${cursor}`
				);
			}
		}
		parts.push(...(delta.parts as T[]));
		cursor = delta.end;
	}
	return { parts, cursor };
}

/**
 * Merge provider metadata objects
 */
function mergeProviderMetadata(
	a: ProviderMetadata | undefined,
	b: ProviderMetadata | undefined
): ProviderMetadata | undefined {
	if (!a && !b) return undefined;
	return { ...(a ?? {}), ...(b ?? {}) };
}

/**
 * Join text parts into a single string
 */
function joinText(parts: UIMessage['parts']): string {
	return parts
		.map((part) => {
			if (part.type === 'text') {
				return part.text;
			}
			return '';
		})
		.join('');
}

/**
 * Extract reasoning content from message parts
 */
export function extractReasoning(parts: MessagePart[] | undefined): string {
	if (!parts) return '';
	return parts
		.map((part) => {
			if (part.type === 'reasoning') {
				return (part as ReasoningUIPart).reasoning;
			}
			return '';
		})
		.join('');
}

/**
 * Extract text content from user message (handles various formats)
 */
export function extractUserMessageText(msg: ChatMessage): string {
	// First try msg.text (UIMessage field)
	if (msg.text && typeof msg.text === 'string') {
		return msg.text;
	}

	// Then try msg.message.content
	if (msg.message?.content !== undefined && msg.message?.content !== null) {
		const content = msg.message.content;

		// String content (most common)
		if (typeof content === 'string') {
			return content;
		}

		// Array content (multimodal messages)
		if (Array.isArray(content)) {
			return content
				.map((part) => {
					if (typeof part === 'string') return part;
					if (part && typeof part === 'object' && 'text' in part) return part.text;
					return '';
				})
				.filter(Boolean)
				.join(' ');
		}

		// Object content with text field
		if (typeof content === 'object' && content !== null && 'text' in content) {
			return (content as { text: string }).text;
		}
	}

	return '';
}

/**
 * Normalize message to ensure top-level role exists
 */
export function normalizeMessage<T extends ChatMessage>(msg: T): T {
	return {
		...msg,
		role: msg.role || msg.message?.role || 'assistant'
	};
}

/**
 * Update UIMessage from text stream parts
 */
export function updateFromTextStreamParts(
	threadId: string,
	streamMessage: StreamMessage,
	existing: { streamId: string; cursor: number; message: UIMessage } | undefined,
	deltas: StreamDelta[]
): [{ streamId: string; cursor: number; message: UIMessage }, boolean] {
	const { cursor, parts } = getParts<TextStreamPart<ToolSet>>(deltas, existing?.cursor);
	const changed =
		parts.length > 0 ||
		(existing && statusFromStreamStatus(streamMessage.status) !== existing.message.status);
	const existingMessage = existing?.message ?? blankUIMessage(streamMessage, threadId);

	if (!changed) {
		return [
			existing ?? {
				streamId: streamMessage.streamId,
				cursor,
				message: existingMessage
			},
			false
		];
	}

	const message: UIMessage = structuredClone(existingMessage);
	message.status = statusFromStreamStatus(streamMessage.status);

	const textPartsById = new Map<string, TextUIPart>();
	const reasoningPartsById = new Map<string, ReasoningUIPart>();

	for (const part of parts) {
		switch (part.type) {
			case 'text-start':
			case 'text-delta': {
				if (!textPartsById.has(part.id)) {
					const lastPart = message.parts.at(-1);
					if (lastPart?.type === 'text') {
						textPartsById.set(part.id, lastPart);
					} else {
						const newPart = {
							type: 'text',
							text: '',
							providerMetadata: part.providerMetadata
						} satisfies TextUIPart;
						textPartsById.set(part.id, newPart);
						message.parts.push(newPart);
					}
				}
				if (part.type === 'text-delta') {
					const textPart = textPartsById.get(part.id)!;
					const delta = (part as { delta?: string }).delta ?? '';
					textPart.text += delta;
					textPart.providerMetadata = mergeProviderMetadata(
						textPart.providerMetadata,
						part.providerMetadata
					);
				}
				break;
			}
			case 'reasoning-start':
			case 'reasoning-delta': {
				if (!reasoningPartsById.has(part.id)) {
					const lastPart = message.parts.at(-1);
					if (lastPart?.type === 'reasoning') {
						reasoningPartsById.set(part.id, lastPart as unknown as ReasoningUIPart);
					} else {
						const newPart = {
							type: 'reasoning',
							reasoning: '',
							providerMetadata: part.providerMetadata
						} satisfies ReasoningUIPart;
						reasoningPartsById.set(part.id, newPart);

						message.parts.push(newPart as any);
					}
				}
				if (part.type === 'reasoning-delta') {
					const reasoningPart = reasoningPartsById.get(part.id)!;
					const delta = (part as { delta?: string }).delta ?? '';
					reasoningPart.reasoning += delta;
					reasoningPart.providerMetadata = mergeProviderMetadata(
						reasoningPart.providerMetadata,
						part.providerMetadata
					);
				}
				break;
			}
			case 'tool-input-start': {
				// Tool input is starting to stream
				const inputStart = part as {
					type: 'tool-input-start';
					id: string;
					toolName: string;
				};
				const toolPartType = `tool-${inputStart.toolName}`;

				// Create streaming tool part with temporary ID (will be updated with toolCallId later)
				const newToolPart = {
					type: toolPartType,
					toolName: inputStart.toolName,
					streamId: inputStart.id, // Track by stream id until we get toolCallId
					input: {},
					state: 'input-streaming'
				};
				message.parts.push(newToolPart as any);
				break;
			}
			case 'tool-input-delta': {
				// Incremental input delta - we can't easily parse partial JSON
				// so we just wait for the complete tool-call event
				break;
			}
			case 'tool-input-end': {
				// Tool input finished streaming, but we wait for tool-call for complete data
				break;
			}
			case 'tool-call': {
				// Complete tool call with all args
				const toolCall = part as {
					type: 'tool-call';
					toolCallId: string;
					toolName: string;
					input: Record<string, unknown>;
				};
				const toolPartType = `tool-${toolCall.toolName}`;

				// Find by streamId (which equals toolCallId) OR by existing toolCallId
				const existingToolPart = message.parts.find(
					(p) =>
						p.type === toolPartType &&
						((p as any).streamId === toolCall.toolCallId ||
							(p as any).toolCallId === toolCall.toolCallId)
				);

				if (existingToolPart) {
					// Update existing streaming part with complete data
					(existingToolPart as any).toolCallId = toolCall.toolCallId;
					(existingToolPart as any).input = toolCall.input;
					(existingToolPart as any).state = 'input-available';
					delete (existingToolPart as any).streamId;
				} else {
					// Create new complete tool call part
					const newToolPart = {
						type: toolPartType,
						toolCallId: toolCall.toolCallId,
						toolName: toolCall.toolName,
						input: toolCall.input,
						state: 'input-available'
					};
					message.parts.push(newToolPart as any);
				}
				break;
			}
			case 'tool-result': {
				// Handle tool result - find matching tool call and add output
				const resultPart = part as unknown as {
					type: 'tool-result';
					toolCallId: string;
					toolName: string;
					output: unknown;
				};
				const toolPartType = `tool-${resultPart.toolName}`;

				const matchingToolPart = message.parts.find(
					(p) => p.type === toolPartType && (p as any).toolCallId === resultPart.toolCallId
				);

				if (matchingToolPart) {
					(matchingToolPart as any).output = resultPart.output;
					(matchingToolPart as any).state = 'output-available';
				}
				break;
			}
		}
	}

	message.text = joinText(message.parts);
	return [{ streamId: streamMessage.streamId, cursor, message }, true];
}

/**
 * Derive UIMessages from text stream parts
 *
 * Main entry point for processing streaming deltas into displayable messages
 */
export function deriveUIMessagesFromTextStreamParts(
	threadId: string,
	streamMessages: StreamMessage[],
	existingStreams: Array<{
		streamId: string;
		cursor: number;
		message: UIMessage;
	}>,
	allDeltas: StreamDelta[]
): [UIMessage[], Array<{ streamId: string; cursor: number; message: UIMessage }>, boolean] {
	const newStreams: Array<{
		streamId: string;
		cursor: number;
		message: UIMessage;
	}> = [];
	let changed = false;
	for (const streamMessage of streamMessages) {
		const deltas = allDeltas.filter((d) => d.streamId === streamMessage.streamId);
		const existing = existingStreams.find((s) => s.streamId === streamMessage.streamId);
		const [newStream, messageChanged] = updateFromTextStreamParts(
			threadId,
			streamMessage,
			existing,
			deltas
		);
		newStreams.push(newStream);
		if (messageChanged) changed = true;
	}
	for (const { streamId } of existingStreams) {
		if (!newStreams.find((s) => s.streamId === streamId)) {
			changed = true;
		}
	}
	const messages = newStreams
		.map((s) => s.message)
		.sort((a, b) => {
			if (a.order !== b.order) return a.order - b.order;
			return a.stepOrder - b.stepOrder;
		});
	return [messages, newStreams, changed];
}

/**
 * Cache manager for stream state
 *
 * Manages reasoning cache and stream status cache to prevent UI flicker
 * during query transitions.
 */
export class StreamCacheManager {
	private reasoningCache = new Map<number, string>();
	private streamStatusCache = new Map<number, StreamStatus>();

	/**
	 * Get cached reasoning for a message order
	 */
	getCachedReasoning(order: number): string | undefined {
		return this.reasoningCache.get(order);
	}

	/**
	 * Update reasoning cache
	 */
	updateReasoningCache(order: number, reasoning: string): void {
		if (reasoning) {
			this.reasoningCache.set(order, reasoning);
		}
	}

	/**
	 * Clear reasoning cache for a message order
	 */
	clearReasoningCache(order: number): void {
		this.reasoningCache.delete(order);
	}

	/**
	 * Get cached stream status for a message order
	 */
	getCachedStatus(order: number): StreamStatus | undefined {
		return this.streamStatusCache.get(order);
	}

	/**
	 * Update stream status cache
	 */
	updateStatusCache(order: number, status: StreamStatus): void {
		this.streamStatusCache.set(order, status);
	}

	/**
	 * Check if status cache has entry for order
	 */
	hasStatusCache(order: number): boolean {
		return this.streamStatusCache.has(order);
	}

	/**
	 * Clear all caches
	 */
	clear(): void {
		this.reasoningCache.clear();
		this.streamStatusCache.clear();
	}
}
