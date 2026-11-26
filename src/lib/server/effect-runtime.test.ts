import * as Effect from 'effect/Effect';
import * as Tracer from 'effect/Tracer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runServerEffect } from './effect-runtime';

function stackDepth(): number {
	const limit = Error.stackTraceLimit;
	Error.stackTraceLimit = Infinity;
	const depth = new Error().stack?.split('\n').length ?? 0;
	Error.stackTraceLimit = limit;
	return depth;
}

describe('runServerEffect', () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('finishes two runs whose waits overlap in overlap', async () => {
		const { promise: opened, resolve: open } = Promise.withResolvers<void>();
		const waiting = runServerEffect(
			Effect.promise(() => opened).pipe(Effect.as('waited for the other run'))
		);
		const opening = runServerEffect(Effect.sync(open).pipe(Effect.as('opened')));

		await expect(Promise.all([waiting, opening])).resolves.toEqual([
			'waited for the other run',
			'opened'
		]);
	}, 2_000);

	it('fires timers', async () => {
		const startedAt = Date.now();
		await expect(runServerEffect(Effect.sleep('30 millis').pipe(Effect.as('woke')))).resolves.toBe(
			'woke'
		);
		expect(Date.now() - startedAt).toBeGreaterThanOrEqual(25);
	}, 2_000);

	it('runs a long synchronous loop of steps at a flat stack depth', async () => {
		const depths: number[] = [];
		const loop = (left: number): Effect.Effect<number> =>
			left === 0
				? Effect.sync(() => {
						depths.push(stackDepth());
						return depths.length;
					})
				: Effect.flatMap(
						Effect.sync(() => {
							if (left % 50_000 === 0) depths.push(stackDepth());
						}),
						() => loop(left - 1)
					);

		await expect(runServerEffect(loop(1_000_000))).resolves.toBe(21);
		const afterFirstYield = depths.slice(1);
		expect(Math.max(...afterFirstYield)).toBe(Math.min(...afterFirstYield));
	}, 20_000);

	it('lets a pending timer fire before a long chain of steps finishes', async () => {
		let steps = 0;
		let stepsWhenTimerFired = -1;
		setTimeout(() => {
			stepsWhenTimerFired = steps;
		}, 0);
		const loop = (left: number): Effect.Effect<void> =>
			left === 0
				? Effect.void
				: Effect.flatMap(
						Effect.sync(() => {
							steps += 1;
						}),
						() => loop(left - 1)
					);

		await runServerEffect(loop(200_000));

		expect(stepsWhenTimerFired).toBeGreaterThanOrEqual(0);
		expect(stepsWhenTimerFired).toBeLessThan(200_000);
	}, 20_000);

	it('rethrows the failure value itself', async () => {
		const failure = new Error('refused');
		await expect(runServerEffect(Effect.fail(failure))).rejects.toBe(failure);
		await expect(runServerEffect(Effect.die(failure))).rejects.toBe(failure);
	});

	it('records a log as an event on the active span', async () => {
		const events: string[] = [];
		const tracer = Tracer.make({
			span(options) {
				const span = new Tracer.NativeSpan(options);
				const record = span.event.bind(span);
				span.event = (name, startTime, attributes) => {
					events.push(name);
					record(name, startTime, attributes);
				};
				return span;
			}
		});
		vi.spyOn(console, 'log').mockImplementation(() => {});

		await runServerEffect(
			Effect.log('loaded the viewer').pipe(Effect.withSpan('load'), Effect.withTracer(tracer))
		);

		expect(events).toEqual(['loaded the viewer']);
	});
});
