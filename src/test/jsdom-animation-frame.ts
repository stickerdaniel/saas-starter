/**
 * This runner's jsdom never invokes `requestAnimationFrame`. Svelte's async
 * `tick()` and tooltip dismissal both wait for that callback, so a test that
 * fakes `setTimeout` would wait forever if the frame itself were faked.
 *
 * A microtask per frame does not yield: a callback that schedules another
 * frame runs until the stack ends, and a timer or pointer release queued
 * beside it never gets a turn. Batch every frame requested in this turn, then
 * run that batch from the real timer captured here, which fake timers do not
 * replace. The next self-scheduled frame waits for another turn, so a timer
 * can run between frames. Cancelling a frame drops it before that turn.
 */
const realSetTimeout = globalThis.setTimeout.bind(globalThis);

const cancelled = new Set<number>();
const pending = new Map<number, FrameRequestCallback>();
let nextFrame = 1;
let batchTimer: ReturnType<typeof setTimeout> | undefined;

function flushFrames() {
	batchTimer = undefined;
	const frames = [...pending];
	pending.clear();
	const now = performance.now();
	for (const [id, callback] of frames) {
		if (cancelled.delete(id)) continue;
		try {
			callback(now);
		} catch (error) {
			// A native frame reports the error and continues the rest of the batch.
			// Stopping here would drop a later Svelte tick scheduled in the same turn.
			const reported = error instanceof Error ? error : new Error(String(error));
			const ErrorEventCtor = globalThis.ErrorEvent;
			let prevented = false;
			if (typeof ErrorEventCtor === 'function' && typeof globalThis.dispatchEvent === 'function') {
				const event = new ErrorEventCtor('error', {
					message: `Uncaught ${reported.name}: ${reported.message}`,
					error: reported,
					cancelable: true
				});
				globalThis.dispatchEvent(event);
				prevented = event.defaultPrevented;
			}
			// `preventDefault` means a listener took the error. Otherwise it stays uncaught,
			// without aborting the callbacks already queued in this batch.
			if (!prevented) {
				realSetTimeout(() => {
					throw reported;
				}, 0);
			}
		}
	}
}

globalThis.requestAnimationFrame = (callback: FrameRequestCallback) => {
	const id = nextFrame++;
	pending.set(id, callback);
	if (batchTimer === undefined) {
		batchTimer = realSetTimeout(flushFrames, 0);
	}
	return id;
};

globalThis.cancelAnimationFrame = (id: number) => {
	if (pending.delete(id)) return;
	cancelled.add(id);
};
