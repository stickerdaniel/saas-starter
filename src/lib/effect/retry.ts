import * as Duration from 'effect/Duration';
import * as Effect from 'effect/Effect';
import * as Schedule from 'effect/Schedule';
import { isRetryable } from './errors';

const MAX_DELAY = Duration.seconds(5);

export const retryPolicy = Schedule.exponential('200 millis').pipe(
	Schedule.jittered,
	Schedule.modifyDelay(({ duration }) => Effect.succeed(Duration.min(duration, MAX_DELAY)))
);

export interface RetryOptions<E, R> {
	readonly schedule?: Schedule.Schedule<unknown, E, never, R>;
	readonly times?: number;
	readonly while?: (error: E) => boolean;
}

export const withRetry = <A, E, R, R2 = never>(
	effect: Effect.Effect<A, E, R>,
	{ schedule = retryPolicy, times = 3, while: shouldRetry = isRetryable }: RetryOptions<E, R2> = {}
): Effect.Effect<A, E, R | R2> =>
	Effect.retry(
		effect,
		Schedule.passthrough(schedule).pipe(
			Schedule.while(({ attempt }) => attempt <= times),
			Schedule.while(({ input }) => shouldRetry(input))
		)
	);
