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

	it('keys a non-leading reasoning block by its ordinal', () => {
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
		expect(reasoning[1]).toMatchObject({ key: 'reasoning-1' });
	});

	// The persisted copy of the same message carries no part ids, and it opens its
	// step before the tool call rather than before the thought (measured against
	// `toUIMessages`), so a key read off an id or an array index would move when it
	// takes over from the live snapshot.
	it('keeps the reasoning keys when the ids and step boundaries are gone', () => {
		const result = deriveOrderedParts(
			[
				{ type: 'reasoning', text: 'First' },
				{ type: 'step-start' },
				{ type: 'tool-getWeather', toolCallId: 't1', state: 'output-available' },
				{ type: 'reasoning', text: 'Second' }
			] as MessagePart[],
			'success'
		);
		const reasoning = result.filter((p) => p.kind === 'reasoning');
		expect(reasoning.map((p) => p.key)).toEqual([LEADING_REASONING_KEY, 'reasoning-1']);
	});

	// Reasoning, text and tool items are siblings in one keyed block, so a tool call
	// id that looks like a reasoning ordinal would key two of them the same and put
	// Svelte into its duplicate-key path.
	it('keeps a tool call id out of the reasoning key namespace', () => {
		const result = deriveOrderedParts(
			[
				{ type: 'reasoning', text: 'First' },
				{ type: 'tool-lookup', toolCallId: 'reasoning-1', state: 'output-available' },
				{ type: 'reasoning', text: 'Second' }
			] as MessagePart[],
			'success'
		);

		expect(new Set(result.map((p) => p.key)).size).toBe(result.length);
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

	it('marks only a trailing text block as streaming', () => {
		const parts = [
			{ type: 'reasoning', text: 'thinking', streamPartId: 'r1' },
			{ type: 'text', text: 'live answer' }
		] as MessagePart[];

		expect(deriveOrderedParts(parts, 'streaming')[1]).toMatchObject({
			kind: 'text',
			isStreaming: true
		});
		expect(deriveOrderedParts(parts, 'success')[1]).toMatchObject({
			kind: 'text',
			isStreaming: false
		});
	});

	it('does not replay completed text through trailing metadata', () => {
		const result = deriveOrderedParts(
			[
				{ type: 'text', text: 'finished answer', state: 'done' },
				{ type: 'source-url', url: 'https://example.com' }
			] as MessagePart[],
			'streaming'
		);

		expect(result[0]).toMatchObject({ kind: 'text', isStreaming: false });
	});

	it('does not replay settled text after a new step starts', () => {
		const result = deriveOrderedParts(
			[
				{ type: 'text', text: 'finished first step', state: 'done' },
				{ type: 'step-start' }
			] as MessagePart[],
			'streaming'
		);

		expect(result[0]).toMatchObject({ kind: 'text', isStreaming: false });
	});

	it('does not replay settled text while a trailing tool streams', () => {
		const result = deriveOrderedParts(
			[
				{ type: 'text', text: 'before the tool' },
				{ type: 'tool-getWeather', toolCallId: 't1', state: 'input-streaming' }
			] as MessagePart[],
			'streaming'
		);

		expect(result[0]).toMatchObject({ kind: 'text', isStreaming: false });
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
