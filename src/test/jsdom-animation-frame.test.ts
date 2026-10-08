import { expect, it } from 'vitest';

it('runs a timer between self-scheduled frames instead of spinning the frame', async () => {
	let frames = 0;
	let released = false;
	const loop = () => {
		frames += 1;
		if (!released && frames < 200) requestAnimationFrame(loop);
	};
	requestAnimationFrame(loop);
	await new Promise((resolve) => setTimeout(resolve, 40));
	released = true;
	// A microtask frame runs the whole cap before this timer. A yielding frame
	// gets a handful of turns in the same wait.
	expect(frames).toBeGreaterThan(0);
	expect(frames).toBeLessThan(200);
});

it('reports a frame error and still runs the rest of the batch', async () => {
	const errors: string[] = [];
	const onError = (event: ErrorEvent) => {
		errors.push(event.message);
		event.preventDefault();
	};
	window.addEventListener('error', onError);
	let second = false;
	try {
		requestAnimationFrame(() => {
			throw new Error('planted frame callback failure');
		});
		requestAnimationFrame(() => {
			second = true;
		});
		await new Promise((resolve) => setTimeout(resolve, 40));
	} finally {
		window.removeEventListener('error', onError);
	}
	expect(second).toBe(true);
	expect(errors).toEqual(['Uncaught Error: planted frame callback failure']);
});

it('does not run a frame cancelled before its turn', async () => {
	let ran = false;
	const id = requestAnimationFrame(() => {
		ran = true;
	});
	cancelAnimationFrame(id);
	await new Promise((resolve) => setTimeout(resolve, 20));
	expect(ran).toBe(false);
});
