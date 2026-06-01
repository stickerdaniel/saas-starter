import { describe, expect, it } from 'vitest';
import type { MessagePart } from '../core/types.js';
import { deriveOrderedParts, LEADING_REASONING_KEY } from './ordered-parts.js';

describe('deriveOrderedParts', () => {
	// Regression guard: a step-start-only parts array must yield no renderable parts, so the
	// caller keeps the "Connecting…" fallback mounted instead of rendering an empty list and
	// blinking the reasoning indicator out between connecting and thinking.
	it('returns [] for a step-start-only parts array', () => {
		expect(deriveOrderedParts([{ type: 'step-start' }] as MessagePart[], 'streaming')).toEqual([]);
	});

	it('returns one reasoning entry once a reasoning part follows step-start', () => {
		const result = deriveOrderedParts(
			[
				{ type: 'step-start' },
				{ type: 'reasoning', text: 'Hi', streamPartId: 'r1' }
			] as MessagePart[],
			'streaming'
		);
		expect(result).toHaveLength(1);
		expect(result[0]).toMatchObject({
			kind: 'reasoning',
			text: 'Hi',
			hasContent: true,
			key: LEADING_REASONING_KEY
		});
	});

	it('keys the leading reasoning with LEADING_REASONING_KEY even without a preceding part', () => {
		const result = deriveOrderedParts(
			[{ type: 'reasoning', text: 'thinking', streamPartId: 'r1' }] as MessagePart[],
			'streaming'
		);
		expect(result[0]).toMatchObject({ key: LEADING_REASONING_KEY });
	});

	it('keeps the real part key for a non-leading reasoning block', () => {
		const result = deriveOrderedParts(
			[
				{ type: 'reasoning', text: 'First', streamPartId: 'r1' },
				{ type: 'tool-getWeather', toolCallId: 't1', state: 'output-available' },
				{ type: 'reasoning', text: 'Second', streamPartId: 'r2' }
			] as MessagePart[],
			'streaming'
		);
		const reasoning = result.filter((p) => p.kind === 'reasoning');
		expect(reasoning[0]).toMatchObject({ key: LEADING_REASONING_KEY });
		expect(reasoning[1]).toMatchObject({ key: 'reasoning-r2' });
	});

	it('marks the trailing reasoning part as streaming only while in progress', () => {
		const parts = [
			{ type: 'reasoning', text: 'a', streamPartId: 'r1' },
			{ type: 'reasoning', text: 'b', streamPartId: 'r2' }
		] as MessagePart[];

		const streaming = deriveOrderedParts(parts, 'streaming');
		expect(streaming[0]).toMatchObject({ isStreaming: false });
		expect(streaming[1]).toMatchObject({ isStreaming: true });

		const done = deriveOrderedParts(parts, 'success');
		expect(done[0]).toMatchObject({ isStreaming: false });
		expect(done[1]).toMatchObject({ isStreaming: false });
	});

	it('orders interleaved reasoning/tool/text and drops step-start', () => {
		const result = deriveOrderedParts(
			[
				{ type: 'step-start' },
				{ type: 'reasoning', text: 'think', streamPartId: 'r1' },
				{ type: 'tool-getWeather', toolCallId: 't1', state: 'output-available' },
				{ type: 'text', text: 'answer' }
			] as MessagePart[],
			'streaming'
		);
		expect(result.map((p) => p.kind)).toEqual(['reasoning', 'tool', 'text']);
	});

	it('handles undefined and empty parts', () => {
		expect(deriveOrderedParts(undefined, 'success')).toEqual([]);
		expect(deriveOrderedParts([], 'pending')).toEqual([]);
	});
});
