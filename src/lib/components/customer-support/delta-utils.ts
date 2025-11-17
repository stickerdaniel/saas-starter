/**
 * Framework-agnostic delta processing utilities
 * Copied from @convex-dev/agent/src/deltas.ts
 * These functions process streaming deltas into UIMessages with progressive text
 */

import type { TextStreamPart, TextUIPart, ToolSet, ProviderMetadata } from 'ai';
import type { UIMessage } from '@convex-dev/agent';
import type { StreamDelta, StreamMessage, MessageStatus } from '@convex-dev/agent/validators';

// Extended UIPart types to include reasoning
export type ReasoningUIPart = {
	type: 'reasoning';
	reasoning: string;
	providerMetadata?: ProviderMetadata;
};

export type ExtendedUIPart = TextUIPart | ReasoningUIPart;

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

export function getParts<T extends StreamDelta['parts'][number]>(
	deltas: StreamDelta[],
	fromCursor?: number
): { parts: T[]; cursor: number } {
	const parts: T[] = [];
	let cursor = fromCursor ?? 0;
	for (const delta of deltas.sort((a, b) => a.start - b.start)) {
		if (delta.parts.length === 0) {
			console.debug(`Got delta with no parts: ${JSON.stringify(delta)}`);
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

function mergeProviderMetadata(
	a: ProviderMetadata | undefined,
	b: ProviderMetadata | undefined
): ProviderMetadata | undefined {
	if (!a && !b) return undefined;
	return { ...(a ?? {}), ...(b ?? {}) };
}

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
export function extractReasoning(parts: UIMessage['parts']): string {
	return parts
		.map((part) => {
			if (part.type === 'reasoning') {
				return (part as unknown as ReasoningUIPart).reasoning;
			}
			return '';
		})
		.join('');
}

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
					const delta = (part as any).delta ?? '';
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
					const delta = (part as any).delta ?? '';
					reasoningPart.reasoning += delta;
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
