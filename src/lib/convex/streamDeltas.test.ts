import { describe, expect, it } from 'vitest';
import { smoothStream } from 'ai';
import { STREAM_DELTA_OPTIONS } from './streamDeltas';

/**
 * The reason for this setting is invisible in the value itself: nothing about
 * the constant says whether `line` or the punctuation-and-whitespace regex
 * stalls a reply. So the guard runs the transform the agent builds from it
 * (`mergeTransforms` pushes exactly `smoothStream({ delayInMs: null, chunking })`,
 * which is not exported) on prose that contains no newline at all, and checks
 * how many parts each setting emits before the reply ends.
 */
const PARAGRAPH =
	'The limiter keys on the caller address, so nothing new has to be threaded ' +
	'through the handler, and the tests that exist already cover the ordinary ' +
	'path. There is one catch worth knowing about before you start on it.';

type Chunking = NonNullable<Parameters<typeof smoothStream>[0]>['chunking'];

async function partsFor(chunking: Chunking) {
	// The transform factory ignores its argument at runtime; the type wants one.
	const { readable, writable } = smoothStream({ delayInMs: null, chunking })({ tools: {} });
	const reader = readable.getReader();
	const parts: string[] = [];
	const drain = (async () => {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			if (value?.type === 'text-delta') parts.push(value.text);
		}
	})();

	const writer = writable.getWriter();
	// Providers emit a few characters per delta rather than whole words.
	for (let index = 0; index < PARAGRAPH.length; index += 4) {
		await writer.write({ type: 'text-delta', text: PARAGRAPH.slice(index, index + 4), id: 'x' });
	}
	await writer.close();
	await drain;
	return parts;
}

describe('stream delta chunking', () => {
	it('emits a paragraph in many small parts', async () => {
		const parts = await partsFor(STREAM_DELTA_OPTIONS.chunking);

		expect(parts.length).toBeGreaterThan(20);
		expect(Math.max(...parts.map((part) => part.length))).toBeLessThan(40);
	});

	// What this replaced, and it is worse than a coarse chunk: with no newline to
	// cut on, nothing is emitted at all. While text deltas keep one id and carry
	// no provider metadata, the buffer flushes only on a newline, so the paragraph
	// waits for the next non-text part.
	it('is not the line chunking that emits nothing without a newline', async () => {
		expect(await partsFor('line')).toHaveLength(0);
	});
});
