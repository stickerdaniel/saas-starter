import { describe, expect, it } from 'vitest';
import * as Cause from 'effect/Cause';
import * as Effect from 'effect/Effect';
import * as Exit from 'effect/Exit';
import type * as Fiber from 'effect/Fiber';
import { MixedScheduler } from 'effect/Scheduler';
import { Lifetime } from './lifetime';

const exitOf = <A, E>(fiber: Fiber.Fiber<A, E>) =>
	new Promise<Exit.Exit<A, E>>((resolve) => fiber.addObserver(resolve));

const settle = (ms = 20) => new Promise((resolve) => setTimeout(resolve, ms));

const captureConsole = async (run: () => Promise<void>) => {
	const lines: string[] = [];
	const { log, error } = console;
	const capture = (...args: unknown[]) => void lines.push(args.map(String).join(' '));
	Object.assign(console, { log: capture, error: capture });
	try {
		await run();
	} finally {
		Object.assign(console, { log, error });
	}
	return lines;
};

describe('Lifetime', () => {
	it('stops a run that ends its lifetime at the next interpreted step', async () => {
		const log: string[] = [];
		const lifetime = new Lifetime();
		const fiber = lifetime.run(
			Effect.gen(function* () {
				log.push('first');
				lifetime.end();
				log.push('same callback');
				yield* Effect.sync(() => log.push('next interpreted step'));
			})
		);

		const exit = await exitOf(fiber);

		expect(log).toEqual(['first', 'same callback']);
		expect(Exit.hasInterrupts(exit)).toBe(true);
	});

	it('has run a synchronous lifetime-scope finalizer when end() returns from outside', () => {
		const log: string[] = [];
		const lifetime = new Lifetime();
		lifetime.run(
			Effect.gen(function* () {
				yield* Effect.addFinalizer(() => Effect.sync(() => log.push('finalizer')));
				yield* Effect.never;
			})
		);

		lifetime.end();
		log.push('end returned');

		expect(log).toEqual(['finalizer', 'end returned']);
	});

	it('has run a synchronous lifetime-scope finalizer when a reentrant end() returns', async () => {
		const log: string[] = [];
		const lifetime = new Lifetime();
		const fiber = lifetime.run(
			Effect.gen(function* () {
				yield* Effect.addFinalizer(() => Effect.sync(() => log.push('finalizer')));
				lifetime.end();
				log.push('end returned');
			})
		);

		await exitOf(fiber);

		expect(log).toEqual(['finalizer', 'end returned']);
	});

	it('completes a yielding lifetime-scope finalizer by whenClosed()', async () => {
		let steps = 0;
		const lifetime = new Lifetime();
		lifetime.run(
			Effect.gen(function* () {
				yield* Effect.addFinalizer(() =>
					Effect.forEach(Array.from({ length: 3_000 }), () => Effect.sync(() => steps++), {
						discard: true
					})
				);
				yield* Effect.never;
			})
		);

		lifetime.end();
		await lifetime.whenClosed();

		expect(steps).toBe(3_000);
	});

	it("runs a run's own ensuring finalizer by whenClosed()", async () => {
		const log: string[] = [];
		const lifetime = new Lifetime();
		lifetime.run(Effect.never.pipe(Effect.ensuring(Effect.sync(() => log.push('ensuring')))));

		lifetime.end();
		await lifetime.whenClosed();

		expect(log).toEqual(['ensuring']);
	});

	it('logs a failed cleanup once and returns from end()', async () => {
		const lifetime = new Lifetime();
		lifetime.run(
			Effect.gen(function* () {
				yield* Effect.addFinalizer(() => Effect.die(new Error('boom')));
				yield* Effect.never;
			})
		);

		const lines = await captureConsole(async () => {
			expect(() => lifetime.end()).not.toThrow();
			await lifetime.whenClosed();
		});

		expect(lines.filter((line) => line.includes('Lifetime cleanup failed'))).toHaveLength(1);
	});

	it('hands a failed cleanup to onCleanupFailure instead of the default log', async () => {
		const causes: Array<Cause.Cause<unknown>> = [];
		const lifetime = new Lifetime({
			onCleanupFailure: (cause) => Effect.sync(() => causes.push(cause))
		});
		lifetime.run(
			Effect.gen(function* () {
				yield* Effect.addFinalizer(() => Effect.die(new Error('boom')));
				yield* Effect.never;
			})
		);

		const lines = await captureConsole(async () => {
			lifetime.end();
			await lifetime.whenClosed();
		});

		expect(causes).toHaveLength(1);
		expect(Cause.hasDies(causes[0]!)).toBe(true);
		expect(lines.filter((line) => line.includes('Lifetime cleanup failed'))).toEqual([]);
	});

	it('returns an interrupted fiber and runs no step after end()', async () => {
		const log: string[] = [];
		const lifetime = new Lifetime();
		lifetime.end();

		const exit = await exitOf(lifetime.run(Effect.sync(() => log.push('step'))));

		expect(log).toEqual([]);
		expect(Exit.hasInterrupts(exit)).toBe(true);
	});

	it('calls an after() callback once its delay passes', async () => {
		const calls: string[] = [];
		const lifetime = new Lifetime();
		lifetime.after(5, () => calls.push('fired'));

		await settle();

		expect(calls).toEqual(['fired']);
	});

	it('skips a cancelled after() callback', async () => {
		const calls: string[] = [];
		const lifetime = new Lifetime();
		const cancel = lifetime.after(5, () => calls.push('cancelled'));
		lifetime.after(5, () => calls.push('kept'));

		cancel();
		await settle();

		expect(calls).toEqual(['kept']);
	});

	it('skips an after() callback whose lifetime ended', async () => {
		const calls: string[] = [];
		const lifetime = new Lifetime();
		lifetime.after(5, () => calls.push('ended'));

		lifetime.end();
		await settle();

		expect(calls).toEqual([]);
	});

	it('keeps auto-yields of owned work on its scheduler', async () => {
		let tasks = 0;
		const scheduler = new MixedScheduler('sync', (task) => {
			tasks++;
			queueMicrotask(task);
			return () => {};
		});
		const lifetime = new Lifetime({ scheduler });

		const exit = await exitOf(
			lifetime.run(
				Effect.forEach(Array.from({ length: 3_000 }), () => Effect.void, { discard: true })
			)
		);

		expect(Exit.isSuccess(exit)).toBe(true);
		expect(tasks).toBeGreaterThan(0);
	});
});
