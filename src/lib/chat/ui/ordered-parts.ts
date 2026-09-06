import type { ToolPart } from '$lib/components/prompt-kit/tool/types.js';
import type { MessagePart, MessageStatus } from '../core/types.js';
import { toToolRenderPart } from './tool-part-adapter.js';
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
	| { kind: 'text'; text: string; key: string };

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

	return messageParts
		.map((p, idx): OrderedPart | null => {
			if (p.type === 'reasoning') {
				const text = typeof p.text === 'string' ? p.text : '';
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
					text: typeof p.text === 'string' ? p.text : '',
					key: `text-${idx}`
				};
			}
			const toolPart = toToolRenderPart(p);
			if (toolPart) {
				return {
					kind: 'tool',
					toolPart,
					key:
						toolPart.toolCallId ??
						('streamId' in p && typeof p.streamId === 'string' ? p.streamId : `tool-${idx}`)
				};
			}
			return null;
		})
		.filter((p): p is OrderedPart => p !== null);
}
