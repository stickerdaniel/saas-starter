import { afterEach, describe, expect, it } from 'vitest';
import * as Effect from 'effect/Effect';
import * as Exit from 'effect/Exit';
import { syncScheduler } from './scheduler';

const timers = { setTimeout: globalThis.setTimeout, setImmediate: globalThis.setImmediate };

const recordTimers = () => {
	const calls: string[] = [];
	Object.assign(globalThis, {
		setTimeout: (...args: Parameters<typeof setTimeout>) => {
			calls.push('setTimeout');
			return timers.setTimeout(...args);
		},
		setImmediate: (...args: Parameters<typeof setImmediate>) => {
			calls.push('setImmediate');
			return timers.setImmediate(...args);
		}
	});
	return calls;
};

describe('syncScheduler', () => {
	afterEach(() => {
		Object.assign(globalThis, timers);
	});

	it('runs a program past its auto-yields without timers', async () => {
		let steps = 0;
		const timerCalls = recordTimers();

		const fiber = Effect.runFork(
			Effect.forEach(Array.from({ length: 3_000 }), () => Effect.sync(() => steps++), {
				discard: true
			}),
			{ scheduler: syncScheduler() }
		);
		const exit = await new Promise<Exit.Exit<void>>((resolve) => fiber.addObserver(resolve));

		expect(Exit.isSuccess(exit)).toBe(true);
		expect(steps).toBe(3_000);
		expect(timerCalls).toEqual([]);
	});
});
