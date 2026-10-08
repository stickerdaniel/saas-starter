/**
 * This runner's jsdom never invokes `requestAnimationFrame`. Svelte's async
 * `tick()` and tooltip dismissal both wait for that callback, so a test that
 * fakes `setTimeout` would wait forever. Run the callback as a microtask,
 * which fake timers do not intercept, and which still settles before a test's
 * own `setTimeout(0)`.
 */
const cancelled = new Set<number>();
let nextFrame = 1;

globalThis.requestAnimationFrame = (callback: FrameRequestCallback) => {
	const id = nextFrame++;
	queueMicrotask(() => {
		if (cancelled.delete(id)) return;
		callback(performance.now());
	});
	return id;
};

globalThis.cancelAnimationFrame = (id: number) => {
	cancelled.add(id);
};
