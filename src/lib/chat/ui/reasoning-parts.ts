import type { MessagePart } from '../core/types.js';

export function getReasoningPartKey(index: number): string {
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
