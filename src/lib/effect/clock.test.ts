import { describe, expect, it } from 'vitest';
import * as Clock from 'effect/Clock';
import * as Effect from 'effect/Effect';
import * as Exit from 'effect/Exit';
import * as Schedule from 'effect/Schedule';
import { clockFromSleep } from './clock';
import { withRetry } from './retry';

describe('clockFromSleep', () => {
	it('runs retry delays through the injected sleep', async () => {
		const sleeps: number[] = [];
		let attempts = 0;
		const failing = Effect.suspend(() => {
			attempts++;
			return Effect.fail('unavailable');
		});

		const exit = await Effect.runPromiseExit(
			withRetry(failing, {
				schedule: Schedule.spaced('300 millis'),
				times: 1,
				while: () => true
			}).pipe(
				Effect.provideService(
					Clock.Clock,
					clockFromSleep(async (ms) => {
						sleeps.push(ms);
					})
				)
			)
		);

		expect(Exit.isFailure(exit)).toBe(true);
		expect(attempts).toBe(2);
		expect(sleeps).toEqual([300]);
	});
});
