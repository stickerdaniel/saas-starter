import type { MessagePart } from '../core/types.js';

export function getReasoningPartKey(part: MessagePart, index: number): string {
	if (part.type === 'reasoning') {
		const record = part as { streamPartId?: unknown; id?: unknown };
		const partId = record.streamPartId ?? record.id;
		if (typeof partId === 'string') {
			return `reasoning-${partId}`;
		}
	}

	return `reasoning-${index}`;
}

export function getActiveStreamingReasoningIndex(
	parts: MessagePart[] | undefined,
	isMessageStreaming: boolean
): number {
	if (!isMessageStreaming || !parts?.length) {
		return -1;
	}

	const lastIndex = parts.length - 1;
	return parts[lastIndex]?.type === 'reasoning' ? lastIndex : -1;
}
