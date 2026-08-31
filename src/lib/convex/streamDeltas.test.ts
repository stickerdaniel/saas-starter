import { describe, expect, it } from 'vitest';
import { smoothStream } from 'ai';
import { STREAM_DELTA_OPTIONS } from './streamDeltas';

/**
 * The reason for this setting is invisible in the value itself: `line` and the
 * clause regex differ only in how long a reply can stall before anything is
 * written, and nothing about the constant says which one stalls. So the guard
 * runs the transform the agent builds from it (`mergeTransforms` pushes exactly
 * `smoothStream({ delayInMs: null, chunking })`, which is not exported) and
 * measures the stall on prose that contains no newline at all: the shape where
 * line chunking emits one part for the entire paragraph.
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
	// cut on, nothing is emitted at all. The buffer only flushes on a chunk of
	// another type, so the whole paragraph waits for the end of the reply.
	it('is not the line chunking that emits nothing without a newline', async () => {
		expect(await partsFor('line')).toHaveLength(0);
	});

	it('still throttles writes to ten per second of generation', () => {
		expect(STREAM_DELTA_OPTIONS.throttleMs).toBe(100);
	});
});
