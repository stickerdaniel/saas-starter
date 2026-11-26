import * as Effect from 'effect/Effect';
import { describe, expect, it } from 'vitest';
import { runServerEffect } from './effect-runtime';

function stackDepth(): number {
	const limit = Error.stackTraceLimit;
	Error.stackTraceLimit = Infinity;
	const depth = new Error().stack?.split('\n').length ?? 0;
	Error.stackTraceLimit = limit;
	return depth;
}

describe('runServerEffect', () => {
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

	it('rethrows the failure value itself', async () => {
		const failure = new Error('refused');
		await expect(runServerEffect(Effect.fail(failure))).rejects.toBe(failure);
		await expect(runServerEffect(Effect.die(failure))).rejects.toBe(failure);
	});
});
