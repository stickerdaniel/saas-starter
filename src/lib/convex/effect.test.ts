import { expect, it } from '@effect/vitest';
import * as Cause from 'effect/Cause';
import * as Clock from 'effect/Clock';
import * as Effect from 'effect/Effect';
import * as Exit from 'effect/Exit';
import { queryClock } from './effect';

// Convex fails a query that requests a timer. The query clock turns
// `Effect.sleep` into a defect at the call instead.
it.effect('Effect.sleep under the query clock dies without requesting a timer', () =>
	Effect.gen(function* () {
		const exit = yield* Effect.exit(
			Effect.sleep('1 second').pipe(Effect.provideService(Clock.Clock, queryClock))
		);
		expect(Exit.isFailure(exit) && Cause.hasDies(exit.cause)).toBe(true);
	})
);
