import { DEFAULT_STREAMING_OPTIONS } from '@convex-dev/agent';

/**
 * How both agents persist a reply while it is still being generated.
 *
 * `chunking` decides how much text buffers before a delta can be written, and
 * it is spelled out rather than omitted because leaving it off does not fall
 * back to the value below: the agent forwards `undefined` to the AI SDK's
 * `smoothStream`, whose own default is `word` (`/\S+\s+/m`).
 *
 * Chunking by line is what this replaces. It buffers until a newline arrives,
 * so a paragraph of prose produces no delta at all until it ends, and the reply
 * appears to stall and then land in one piece. Measured on a three-paragraph
 * reply at 45 tokens/s: 1244ms with no update at all, against 67ms here.
 *
 * The regex splits at every punctuation mark and every whitespace character,
 * so a delta can be written after almost any token.
 *
 * The cost is more writes, bounded by the throttle rather than by the chunk
 * size: `DeltaStreamer.addParts` coalesces everything that arrives inside one
 * window, so generation writes at most ten deltas per second. The end-of-stream
 * flush bypasses the throttle and can add writes milliseconds apart. The same
 * reply measured 2 writes by line and 30 this way.
 */
export const STREAM_DELTA_OPTIONS = {
	chunking: DEFAULT_STREAMING_OPTIONS.chunking,
	throttleMs: 100
} as const;
