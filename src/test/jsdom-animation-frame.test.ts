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

it('does not run a frame cancelled before its turn', async () => {
	let ran = false;
	const id = requestAnimationFrame(() => {
		ran = true;
	});
	cancelAnimationFrame(id);
	await new Promise((resolve) => setTimeout(resolve, 20));
	expect(ran).toBe(false);
});
