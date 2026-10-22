import type { StreamDelta } from '@convex-dev/agent/validators';

/**
 * Stream deltas received so far for one thread: per stream ID, the deltas
 * that run contiguously from start 0.
 *
 * `@convex-dev/agent` returns at most 100 deltas per stream for one cursor, so
 * a long reply arrives over several pages. Delta `start` and `end` count
 * stream parts, not delta records or characters.
 */
export type ReceivedStreamDeltas = {
	readonly threadId: string | null;
	readonly streams: ReadonlyMap<string, readonly StreamDelta[]>;
};

/** Where a `listDeltas` request resumes reading one stream. */
export type DeltaCursor = { streamId: string; cursor: number };

export function noStreamDeltas(threadId: string | null): ReceivedStreamDeltas {
	return { threadId, streams: new Map() };
}

/**
 * Restricts received deltas to the current thread and its active streams.
 * Returns the same reference when nothing is dropped, so derived consumers
 * only rerun on a real change.
 */
export function scopeStreamDeltas(
	received: ReceivedStreamDeltas,
	threadId: string | null,
	streamIds: readonly string[]
): ReceivedStreamDeltas {
	if (received.threadId !== threadId) return noStreamDeltas(threadId);
	const kept = new Set(streamIds);
	if ([...received.streams.keys()].every((streamId) => kept.has(streamId))) return received;
	return {
		threadId,
		streams: new Map([...received.streams].filter(([streamId]) => kept.has(streamId)))
	};
}

/**
 * Cursors for the next delta request: each stream resumes at the end of its
 * last received delta, like the agent's React `useDeltaStreams`. Always asking
 * from 0 would return the same first 100 deltas forever.
 */
export function deltaCursors(
	streamIds: readonly string[],
	received: ReceivedStreamDeltas
): DeltaCursor[] {
	return streamIds.map((streamId) => ({
		streamId,
		cursor: received.streams.get(streamId)?.at(-1)?.end ?? 0
	}));
}

/**
 * Appends one `listDeltas` page to the received deltas of the listed streams
 * and drops every other stream. Deltas before a stream's cursor are repeats
 * and skipped; a gap stops that stream at its cursor so the next request
 * refetches from there. Returns the same reference when nothing changed.
 */
export function appendDeltaPage(
	received: ReceivedStreamDeltas,
	streamIds: readonly string[],
	page: readonly StreamDelta[]
): ReceivedStreamDeltas {
	const scoped = scopeStreamDeltas(received, received.threadId, streamIds);
	let streams: Map<string, readonly StreamDelta[]> | undefined;

	for (const streamId of streamIds) {
		const existing = scoped.streams.get(streamId) ?? [];
		let cursor = existing.at(-1)?.end ?? 0;
		const appended: StreamDelta[] = [];
		const incoming = page
			.filter((delta) => delta.streamId === streamId)
			.sort((a, b) => a.start - b.start);
		for (const delta of incoming) {
			if (delta.start < cursor) continue;
			if (delta.start > cursor) {
				console.warn(`Gap in deltas for stream ${streamId}: ${cursor} -> ${delta.start}`);
				break;
			}
			appended.push(delta);
			cursor = delta.end;
		}
		if (appended.length === 0) continue;
		streams ??= new Map(scoped.streams);
		streams.set(streamId, [...existing, ...appended]);
	}

	return streams ? { threadId: scoped.threadId, streams } : scoped;
}
