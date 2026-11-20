import { describe, expect, it } from 'vitest';
import * as Effect from 'effect/Effect';
import * as Exit from 'effect/Exit';
import * as Fiber from 'effect/Fiber';
import { Invalid, RateLimited, TransportLost } from './errors';
import { withRetry, type RetryOptions } from './retry';
import { adjust, withTestClock } from './testing';

const attemptsUntilExit = <E>(error: E, options?: RetryOptions<E, never>) => {
	let attempts = 0;
	const failing = Effect.suspend(() => {
		attempts++;
		return Effect.fail(error);
	});
	return Effect.runPromise(
		withTestClock(
			Effect.gen(function* () {
				const fiber = yield* Effect.forkChild(withRetry(failing, options));
				yield* adjust('1 minute');
				const exit = yield* Fiber.await(fiber);
				return { attempts, exit };
			})
		)
	);
};

describe('withRetry', () => {
	it.each([
		['a lost transport', new TransportLost({ cause: new Error('socket closed') })],
		['a rate limit', new RateLimited({ retryAfter: 1_000 })]
	])('retries %s three times by default', async (_name, error) => {
		const { attempts, exit } = await attemptsUntilExit(error);

		expect(attempts).toBe(4);
		expect(exit).toEqual(Exit.fail(error));
	});

	it('does not retry a failure that is not retryable', async () => {
		const { attempts } = await attemptsUntilExit(new Invalid({ code: 'BAD_INPUT' }));

		expect(attempts).toBe(1);
	});

	it('hands an untagged failure to while', async () => {
		const seen: unknown[] = [];

		const { attempts } = await attemptsUntilExit('plain failure', {
			while: (error) => {
				seen.push(error);
				return false;
			}
		});

		expect(seen).toEqual(['plain failure']);
		expect(attempts).toBe(1);
	});

	it('asks while only before a retry that times still allows', async () => {
		const seen: unknown[] = [];

		const { attempts } = await attemptsUntilExit('plain failure', {
			times: 1,
			while: (error) => {
				seen.push(error);
				return true;
			}
		});

		expect(attempts).toBe(2);
		expect(seen).toEqual(['plain failure']);
	});
});
