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

	it.each([{ type: 'step-start' }, { type: 'tool-test', state: 'input-streaming' }])(
		'keeps $type as a lifecycle boundary',
		(tail) => {
			const parts = [{ type: 'text', text: 'settled' }, tail] as MessagePart[];
			expect(getActiveStreamingPartIndex(parts, true)).toBe(1);
		}
	);

	it('returns no active content after completion', () => {
		expect(getActiveStreamingPartIndex([{ type: 'text', text: 'done' }], false)).toBe(-1);
	});
});
