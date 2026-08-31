import type { ToolPart } from '$lib/components/prompt-kit/tool/types.js';
import type { MessagePart, MessageStatus } from '../core/types.js';
import {
	getActiveStreamingReasoningIndex,
	getReasoningKey,
	LEADING_REASONING_KEY
} from './reasoning-parts.js';

export { LEADING_REASONING_KEY };

/**
 * A renderable message part in chronological order.
 *
 * `key` is both the Svelte `{#each}` identity and the suffix of the accordion open-state
 * key (`${message.id}:${key}`). The leading reasoning block keys to
 * {@link LEADING_REASONING_KEY} (see `getReasoningKey`), so it stays mounted and keeps its
 * open-state across the connecting → thinking transition; later reasoning blocks keep their
 * per-part key.
 */
export type OrderedPart =
	| { kind: 'reasoning'; text: string; isStreaming: boolean; hasContent: boolean; key: string }
	| { kind: 'tool'; toolPart: ToolPart; key: string }
	| { kind: 'text'; text: string; isStreaming: boolean; key: string };

/**
 * Derive renderable parts for chronological rendering.
 *
 * Non-renderable parts (e.g. `step-start`) are dropped, so a message whose only part is
 * `step-start` returns `[]` and the caller keeps the connecting fallback mounted instead
 * of rendering an empty list.
 */
export function deriveOrderedParts(
	parts: MessagePart[] | undefined,
	status: MessageStatus
): OrderedPart[] {
	const messageParts = parts ?? [];
	const isMessageInProgress = status === 'pending' || status === 'streaming';
	const activeReasoningIndex = getActiveStreamingReasoningIndex(messageParts, isMessageInProgress);
	// A message may stream text, then begin another step or tool before the next
	// text block. Only a text part at the actual tail is live. Looking for the
	// last renderable part is too broad: `step-start` is intentionally not
	// rendered, but it still means the preceding prose has settled.
	const tailIndex = messageParts.length - 1;
	const activeTextIndex =
		isMessageInProgress && messageParts[tailIndex]?.type === 'text' ? tailIndex : -1;

	return messageParts
		.map((p, idx): OrderedPart | null => {
			if (p.type === 'reasoning') {
				const text = (p as { text?: string }).text ?? '';
				return {
					kind: 'reasoning',
					text,
					isStreaming: idx === activeReasoningIndex,
					hasContent: !!text,
					key: getReasoningKey(messageParts, idx)
				};
			}
			if (p.type === 'text') {
				return {
					kind: 'text',
					text: (p as { text?: string }).text ?? '',
					isStreaming: idx === activeTextIndex,
					key: `text-${idx}`
				};
			}
			if (typeof p.type === 'string' && p.type.startsWith('tool-') && 'state' in p) {
				return {
					kind: 'tool',
					toolPart: {
						type: p.type,
						state: (p as { state: ToolPart['state'] }).state,
						input: (p as { input?: Record<string, unknown> }).input,
						output: (p as { output?: unknown }).output as Record<string, unknown> | undefined,
						toolCallId: (p as { toolCallId?: string }).toolCallId,
						errorText: (p as { errorText?: string }).errorText
					},
					key:
						(p as { toolCallId?: string }).toolCallId ??
						(p as { streamId?: string }).streamId ??
						`tool-${idx}`
				};
			}
			return null;
		})
		.filter((p): p is OrderedPart => p !== null);
}
