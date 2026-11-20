import * as Effect from 'effect/Effect';
import * as Fiber from 'effect/Fiber';
import { TestClock } from 'effect/testing';
import { within } from './timeout';
import { describe, expect, it } from './vitest';

describe('within', () => {
	it.effect('returns the fallback once the duration passes', () =>
		Effect.gen(function* () {
			const fiber = yield* Effect.forkChild(
				within(Effect.never, '5 seconds', () => Effect.succeed('timed out'))
			);
			yield* TestClock.adjust('5 seconds');

			expect(yield* Fiber.join(fiber)).toBe('timed out');
		})
	);

	it.effect('returns the value of an effect that finishes in time', () =>
		Effect.gen(function* () {
			const fiber = yield* Effect.forkChild(
				within(Effect.succeed('done').pipe(Effect.delay('4 seconds')), '5 seconds', () =>
					Effect.succeed('timed out')
				)
			);
			yield* TestClock.adjust('5 seconds');

			expect(yield* Fiber.join(fiber)).toBe('done');
		})
	);
});
