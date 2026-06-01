import type { ToolPart } from '$lib/components/prompt-kit/tool/types.js';
import type { MessagePart, MessageStatus } from '../core/types.js';
import { getActiveStreamingReasoningIndex, getReasoningPartKey } from './reasoning-parts.js';

/**
 * Stable Svelte `{#each}` key for the leading reasoning block (the first reasoning
 * part of a message) and its "Connecting…" placeholder. Decoupling DOM identity from
 * the accordion open/close key (which still uses the real part key) keeps a single
 * reasoning component instance mounted across the connecting → thinking transition,
 * so the indicator never blinks out or restarts its shimmer.
 */
export const LEADING_REASONING_KEY = 'reasoning-lead';

/**
 * A renderable message part in chronological order.
 *
 * `key` is the Svelte `{#each}` identity. `partKey` (reasoning only) is the unprefixed
 * accordion part key (`${message.id}:${partKey}` is the open-state key consumed by
 * `reasoning-accordion-sync.ts`). For the leading reasoning block `key` is stabilised to
 * `LEADING_REASONING_KEY` while `partKey` stays the real part key.
 */
export type OrderedPart =
	| {
			kind: 'reasoning';
			text: string;
			isStreaming: boolean;
			hasContent: boolean;
			key: string;
			partKey: string;
	  }
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
	const firstReasoningIndex = messageParts.findIndex((p) => p.type === 'reasoning');

	return messageParts
		.map((p, idx): OrderedPart | null => {
			if (p.type === 'reasoning') {
				const text = (p as { text?: string }).text ?? '';
				const partKey = getReasoningPartKey(p, idx);
				return {
					kind: 'reasoning',
					text,
					isStreaming: idx === activeReasoningIndex,
					hasContent: !!text,
					// Leading reasoning keeps a stable DOM identity for instance continuity.
					key: idx === firstReasoningIndex ? LEADING_REASONING_KEY : partKey,
					partKey
				};
			}
			if (p.type === 'text') {
				return {
					kind: 'text',
					text: (p as { text?: string }).text ?? '',
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
