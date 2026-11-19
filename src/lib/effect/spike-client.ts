/**
 * T0 spike: the browser use the plan expects, for the client-graph measurement.
 * `layoutProbe` is the shared-layout case (retry with backoff inside a bounded
 * wait), `routeProbe` the app-route case (a traced operation with a tagged
 * error). Neither changes what the page shows.
 */
import * as Data from 'effect/Data';
import * as Effect from 'effect/Effect';
import * as Fiber from 'effect/Fiber';
import * as Schedule from 'effect/Schedule';

class TransportLost extends Data.TaggedError('TransportLost')<{ readonly cause: unknown }> {}

export function layoutProbe(ping: () => Promise<unknown>): () => void {
	const program = Effect.tryPromise({
		try: ping,
		catch: (cause) => new TransportLost({ cause })
	}).pipe(
		Effect.retry({ schedule: Schedule.exponential('200 millis'), times: 2 }),
		Effect.timeoutOrElse({ duration: '5 seconds', orElse: () => Effect.void }),
		Effect.ignore
	);
	const fiber = Effect.runFork(program);
	return () => Effect.runFork(Fiber.interrupt(fiber));
}

const measureDraft = Effect.fn('communityChat.measureDraft')(function* (draft: string) {
	if (draft.length === 0) return yield* new TransportLost({ cause: 'empty' });
	return draft.trim().length;
});

export function routeProbe(draft: string): Promise<number> {
	return Effect.runPromise(
		measureDraft(draft).pipe(Effect.catchTag('TransportLost', () => Effect.succeed(0)))
	);
}
