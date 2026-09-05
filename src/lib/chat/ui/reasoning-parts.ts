import type { MessagePart } from '../core/types.js';

/**
 * Stable key for the leading reasoning block (the first reasoning part of a message)
 * and its "Connecting…" placeholder. Used both as the Svelte `{#each}` identity (so the
 * component instance survives the connecting → thinking transition without remounting) and
 * as the accordion open-state key, so a user toggle made on the placeholder carries over to
 * the real leading reasoning part instead of being dropped when the part materializes.
 */
export const LEADING_REASONING_KEY = 'reasoning-lead';

/**
 * Key for the reasoning part at `index` within `parts`. The first reasoning block gets the
 * stable {@link LEADING_REASONING_KEY}; every later block is keyed by its ordinal among the
 * reasoning blocks of the message. Single source of truth shared by rendering
 * (ordered-parts) and accordion sync, so both agree on every reasoning key.
 *
 * The ordinal is the only part of a reasoning block that survives the handover from the
 * live snapshot to the persisted row. A key built from the part id flips once the persisted
 * copy takes over, because `toUIMessages` reconstructs reasoning without an id; a key built
 * from the array index flips because the live snapshot carries `step-start` parts that the
 * persisted row does not. Either flip remounts the block closed and discards the open state
 * of a reader who had expanded it.
 */
export function getReasoningKey(parts: MessagePart[] | undefined, index: number): string {
	const list = parts ?? [];
	let ordinal = 0;
	for (let before = 0; before < index; before += 1) {
		if (list[before]?.type === 'reasoning') ordinal += 1;
	}
	return ordinal === 0 ? LEADING_REASONING_KEY : `reasoning-${ordinal}`;
}

/**
 * Metadata emitted between deltas does not close the content stream it annotates.
 * AI SDK materialization keeps applying later text or reasoning deltas to the
 * earlier content object while source, file and data parts remain after it.
 */
function isTransparentStreamMetadata(part: MessagePart): boolean {
	return part.type === 'file' || part.type.startsWith('source-') || part.type.startsWith('data-');
}

function isCompletedContentPart(part: MessagePart): boolean {
	return (part.type === 'text' || part.type === 'reasoning') && part.state === 'done';
}

/**
 * A step boundary says a step opened, never that the content before it closed. Merging the
 * persisted row with the live snapshot leaves one behind the block that is still being
 * written, because the two views place their `step-start` parts differently (measured), so
 * reading it as the stream tail would render an actively streaming block as finished. The
 * `state` of the content part before it decides instead.
 */
function isStepBoundary(part: MessagePart): boolean {
	return part.type === 'step-start';
}

/**
 * Find the content or lifecycle boundary currently at the stream tail. Unknown
 * parts stay boundaries by default; only step boundaries and AI SDK metadata
 * with measured transparent behavior are skipped.
 */
export function getActiveStreamingPartIndex(
	parts: MessagePart[] | undefined,
	isMessageStreaming: boolean
): number {
	if (!isMessageStreaming || !parts?.length) return -1;

	for (let index = parts.length - 1; index >= 0; index -= 1) {
		const part = parts[index]!;
		if (isTransparentStreamMetadata(part) || isStepBoundary(part)) continue;
		return isCompletedContentPart(part) ? -1 : index;
	}
	return -1;
}

export function getActiveStreamingReasoningIndex(
	parts: MessagePart[] | undefined,
	isMessageStreaming: boolean
): number {
	const activeIndex = getActiveStreamingPartIndex(parts, isMessageStreaming);
	return parts?.[activeIndex]?.type === 'reasoning' ? activeIndex : -1;
}
