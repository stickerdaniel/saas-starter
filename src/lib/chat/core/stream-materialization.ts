import {
	readUIMessageStream,
	type ProviderMetadata,
	type TextStreamPart,
	type ToolSet,
	type UIMessageChunk
} from 'ai';
import type { UIMessage } from '@convex-dev/agent';
import type { StreamDelta, StreamMessage, MessageStatus } from '@convex-dev/agent/validators';
import type { ReasoningUIPart, TextUIPart, ToolCallPart } from './types.js';

/**
 * Extract text content from a stream delta part, handling both formats:
 * - UIMessageChunk format: content is in `delta` field
 * - TextStreamPart format: content is in `text` field
 */
function getDeltaText(part: { text?: string; delta?: string }): string {
	return (part as { delta?: string }).delta ?? part.text ?? '';
}

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
	return { ...a, ...b };
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

function asRecord(part: UIMessage['parts'][number]): Record<string, unknown> {
	return part as Record<string, unknown>;
}

function getStreamPartId(part: UIMessage['parts'][number]): string | undefined {
	const streamPartId = asRecord(part).streamPartId;
	return typeof streamPartId === 'string' ? streamPartId : undefined;
}

function isToolUIPart(part: UIMessage['parts'][number]): boolean {
	return part.type.startsWith('tool-') && typeof asRecord(part).toolCallId === 'string';
}

/**
 * Update a UIMessage from UIMessageChunk deltas using the AI SDK chunk reader.
 */
export async function updateFromUIMessageChunks(
	uiMessage: UIMessage,
	parts: UIMessageChunk[]
): Promise<UIMessage> {
	const partsStream = new ReadableStream<UIMessageChunk>({
		start(controller) {
			for (const part of parts) {
				controller.enqueue(part);
			}
			controller.close();
		}
	});

	let failed = false;
	const messageStream = readUIMessageStream({
		message: uiMessage,
		stream: partsStream,
		onError: (error) => {
			failed = true;
			console.error('Error in UI message stream', error);
		},
		terminateOnError: true
	});

	let message = uiMessage;
	for await (const nextMessage of messageStream) {
		if (nextMessage.id !== message.id) {
			throw new Error('Expected exactly one UI message per stream');
		}
		message = nextMessage;
	}

	if (failed) {
		message.status = 'failed';
	}
	message.text = joinText(message.parts);
	return message;
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
	const reasoningPartsById = new Map<string, ReasoningUIPart & { streamPartId: string }>();

	for (const existingPart of message.parts) {
		const streamPartId = getStreamPartId(existingPart);
		if (existingPart.type === 'reasoning' && streamPartId) {
			reasoningPartsById.set(
				streamPartId,
				existingPart as ReasoningUIPart & { streamPartId: string }
			);
		}
	}

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
					textPart.text += getDeltaText(part);
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
					const newPart = {
						type: 'reasoning',
						text: '',
						state: 'streaming',
						providerMetadata: part.providerMetadata,
						streamPartId: part.id
					} satisfies ReasoningUIPart & { streamPartId: string };
					reasoningPartsById.set(part.id, newPart);
					message.parts.push(newPart);
				}
				if (part.type === 'reasoning-delta') {
					const reasoningPart = reasoningPartsById.get(part.id)!;
					reasoningPart.text = (reasoningPart.text ?? '') + getDeltaText(part);
					reasoningPart.providerMetadata = mergeProviderMetadata(
						reasoningPart.providerMetadata,
						part.providerMetadata
					);
				}
				break;
			}
			case 'tool-call': {
				const toolPartType = `tool-${part.toolName}` as const;
				const existingToolPart = message.parts.find(
					(existingPart) =>
						existingPart.type === toolPartType && getToolCallId(existingPart) === part.toolCallId
				);

				if (existingToolPart) {
					const toolPart = existingToolPart as ToolCallPart;
					toolPart.input = part.input;
					toolPart.state = 'input-available';
				} else {
					const newToolPart = {
						type: toolPartType,
						toolCallId: part.toolCallId,
						input: part.input,
						state: 'input-available'
					} satisfies ToolCallPart;
					message.parts.push(newToolPart);
				}
				break;
			}
			case 'tool-result': {
				const matchingToolPart = message.parts.find(
					(existingPart) => getToolCallId(existingPart) === part.toolCallId
				);

				if (matchingToolPart) {
					const toolPart = matchingToolPart as ToolCallPart;
					if (part.input !== undefined) {
						toolPart.input = part.input;
					}
					toolPart.output = part.output;
					toolPart.state = 'output-available';
				}
				break;
			}
			case 'reasoning-end': {
				const reasoningPart = reasoningPartsById.get(part.id);
				if (reasoningPart) {
					reasoningPart.state = 'done';
					reasoningPart.providerMetadata = mergeProviderMetadata(
						reasoningPart.providerMetadata,
						part.providerMetadata
					);
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
		if (!newStreams.find((stream) => stream.streamId === streamId)) {
			changed = true;
		}
	}
	const messages = newStreams
		.map((stream) => stream.message)
		.sort((a, b) => {
			if (a.order !== b.order) return a.order - b.order;
			return a.stepOrder - b.stepOrder;
		});
	return [messages, newStreams, changed];
}

/**
 * Decode stream deltas using the format declared on each stream.
 */
export async function deriveUIMessagesFromDeltas(
	threadId: string,
	streamMessages: StreamMessage[],
	allDeltas: StreamDelta[]
): Promise<UIMessage[]> {
	const messages = await Promise.all(
		streamMessages.map(async (streamMessage) => {
			const deltas = allDeltas.filter((delta) => delta.streamId === streamMessage.streamId);
			if (streamMessage.format === 'UIMessageChunk') {
				const { parts } = getParts<UIMessageChunk>(deltas, 0);
				return updateFromUIMessageChunks(blankUIMessage(streamMessage, threadId), parts);
			}

			const [uiMessages] = deriveUIMessagesFromTextStreamParts(
				threadId,
				[streamMessage],
				[],
				deltas
			);
			return uiMessages[0]!;
		})
	);

	return messages.sort((a, b) => {
		if (a.order !== b.order) return a.order - b.order;
		return a.stepOrder - b.stepOrder;
	});
}

/**
 * Combine streamed assistant steps so they match the grouped saved-message shape.
 *
 * Mirrors the upstream @convex-dev/agent `combineUIMessages` grouping semantics:
 * repeated assistant steps with the same order collapse into one grouped UI message.
 */
export function combineStreamingUIMessages(messages: UIMessage[]): UIMessage[] {
	const sortedMessages = [...messages].sort((a, b) => {
		if (a.order !== b.order) return a.order - b.order;
		return a.stepOrder - b.stepOrder;
	});

	return sortedMessages.reduce<UIMessage[]>((combined, message) => {
		const previous = combined.at(-1);
		if (
			!previous ||
			message.order !== previous.order ||
			previous.role !== message.role ||
			message.role !== 'assistant'
		) {
			combined.push(structuredClone(message));
			return combined;
		}

		const mergedParts = [...previous.parts];
		for (const part of message.parts) {
			const toolCallId = getToolCallId(part);
			if (!toolCallId) {
				mergedParts.push(part);
				continue;
			}

			const previousPartIndex = mergedParts.findIndex(
				(existingPart) => getToolCallId(existingPart) === toolCallId
			);
			if (previousPartIndex === -1) {
				mergedParts.push(part);
				continue;
			}

			const previousPart = mergedParts.splice(previousPartIndex, 1)[0]!;
			mergedParts.push(mergeStreamParts(previousPart, part));
		}

		combined[combined.length - 1] = {
			...previous,
			status: message.status,
			metadata: message.metadata ?? previous.metadata,
			agentName: message.agentName ?? previous.agentName,
			parts: mergedParts,
			text: joinText(mergedParts)
		};
		return combined;
	}, []);
}

function getToolCallId(part: UIMessage['parts'][number]) {
	return isToolUIPart(part) ? (asRecord(part).toolCallId as string) : undefined;
}

function mergeStreamParts(
	previousPart: UIMessage['parts'][number],
	part: UIMessage['parts'][number]
): UIMessage['parts'][number] {
	const merged: Record<string, unknown> = { ...previousPart };
	for (const [key, value] of Object.entries(part)) {
		if (value !== undefined) {
			merged[key] = value;
		}
	}
	return merged as UIMessage['parts'][number];
}
