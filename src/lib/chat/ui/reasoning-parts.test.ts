import { describe, expect, it } from 'vitest';
import type { MessagePart } from '../core/types.js';
import {
	getActiveStreamingPartIndex,
	getActiveStreamingReasoningIndex
} from './reasoning-parts.js';

const metadata = [
	{ type: 'source-url', url: 'https://example.com' },
	{ type: 'source-document', title: 'Source' },
	{ type: 'file', mediaType: 'text/plain', url: 'https://example.com/file' },
	{ type: 'data-citation', data: { id: 'citation' } }
] as MessagePart[];

describe('active streaming content', () => {
	it.each(metadata)('keeps text active through $type metadata', (tail) => {
		const parts = [{ type: 'text', text: 'still streaming' }, tail] as MessagePart[];
		expect(getActiveStreamingPartIndex(parts, true)).toBe(0);
	});

	it.each(metadata)('keeps reasoning active through $type metadata', (tail) => {
		const parts = [{ type: 'reasoning', text: 'still thinking' }, tail] as MessagePart[];
		expect(getActiveStreamingReasoningIndex(parts, true)).toBe(0);
	});

	it.each(['text', 'reasoning'] as const)(
		'does not keep completed $type active through metadata',
		(type) => {
			const parts = [{ type, text: 'done', state: 'done' }, metadata[0]!] as MessagePart[];
			expect(getActiveStreamingPartIndex(parts, true)).toBe(-1);
			expect(getActiveStreamingReasoningIndex(parts, true)).toBe(-1);
		}
	);

	it('keeps an unresolved tool part as a lifecycle boundary', () => {
		const parts = [
			{ type: 'text', text: 'settled', state: 'done' },
			{ type: 'tool-test', state: 'input-streaming' }
		] as MessagePart[];
		expect(getActiveStreamingPartIndex(parts, true)).toBe(1);
	});

	// The merged view of the handover window puts a step-start behind the block the
	// model is still writing, because the persisted row and the live snapshot place
	// their step boundaries differently. Reading it as the tail rendered an actively
	// streaming thought as a finished one.
	it('does not let an opened step hide the content still being written', () => {
		const parts = [
			{ type: 'reasoning', text: 'first thought and more', state: 'streaming' },
			{ type: 'step-start' }
		] as MessagePart[];
		expect(getActiveStreamingPartIndex(parts, true)).toBe(0);
		expect(getActiveStreamingReasoningIndex(parts, true)).toBe(0);
	});

	it('ends active content when a step opens after finished content', () => {
		const parts = [
			{ type: 'reasoning', text: 'first thought', state: 'done' },
			{ type: 'step-start' }
		] as MessagePart[];
		expect(getActiveStreamingPartIndex(parts, true)).toBe(-1);
		expect(getActiveStreamingReasoningIndex(parts, true)).toBe(-1);
	});

	it('returns no active content after completion', () => {
		expect(getActiveStreamingPartIndex([{ type: 'text', text: 'done' }], false)).toBe(-1);
	});
});
