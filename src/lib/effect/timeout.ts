import type * as Duration from 'effect/Duration';
import * as Effect from 'effect/Effect';

export const within = <A, E, R, A2, E2, R2>(
	effect: Effect.Effect<A, E, R>,
	duration: Duration.Input,
	onTimeout: () => Effect.Effect<A2, E2, R2>
): Effect.Effect<A | A2, E | E2, R | R2> =>
	Effect.timeoutOrElse(effect, { duration, orElse: onTimeout });
