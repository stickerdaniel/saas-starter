import * as Clock from 'effect/Clock';
import * as Duration from 'effect/Duration';
import * as Effect from 'effect/Effect';

export const clockFromSleep = (sleep: (ms: number) => Promise<void>): Clock.Clock => {
	const clock: Clock.Clock = Object.create(Clock.Clock.defaultValue());
	return Object.assign(clock, {
		sleep: (duration: Duration.Duration) => Effect.promise(() => sleep(Duration.toMillis(duration)))
	});
};
