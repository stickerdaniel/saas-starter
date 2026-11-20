import * as Effect from 'effect/Effect';
import * as TestClock from 'effect/testing/TestClock';

export { adjust } from 'effect/testing/TestClock';

export const withTestClock = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
	Effect.provide(effect, TestClock.layer());
