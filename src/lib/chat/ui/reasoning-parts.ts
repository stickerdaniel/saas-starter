import type { MessagePart } from '../core/types.js';

/**
 * Stable key for the leading reasoning block (the first reasoning part of a message)
 * and its "Connecting…" placeholder. Used both as the Svelte `{#each}` identity (so the
 * component instance survives the connecting → thinking transition without remounting) and
 * as the accordion open-state key, so a user toggle made on the placeholder carries over to
 * the real leading reasoning part instead of being dropped when the part materializes.
 */
export const LEADING_REASONING_KEY = 'reasoning-lead';

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

/**
 * Key for a reasoning part at `index` within `parts`. The first reasoning part gets the
 * stable {@link LEADING_REASONING_KEY}; later reasoning blocks keep their per-part key.
 * Single source of truth shared by rendering (ordered-parts) and accordion sync, so both
 * agree on the leading reasoning key.
 */
export function getReasoningKey(parts: MessagePart[] | undefined, index: number): string {
	const list = parts ?? [];
	const firstReasoningIndex = list.findIndex((p) => p.type === 'reasoning');
	if (index === firstReasoningIndex) {
		return LEADING_REASONING_KEY;
	}
	return getReasoningPartKey(list[index]!, index);
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
