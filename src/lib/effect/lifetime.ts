import type * as Cause from 'effect/Cause';
import * as Effect from 'effect/Effect';
import * as Exit from 'effect/Exit';
import type * as Fiber from 'effect/Fiber';
import type { Scheduler } from 'effect/Scheduler';
import * as Scope from 'effect/Scope';

export interface LifetimeOptions {
	readonly scheduler?: Scheduler;
	readonly onCleanupFailure?: (cause: Cause.Cause<unknown>) => Effect.Effect<void>;
}

const logCleanupFailure = (cause: Cause.Cause<unknown>) =>
	Effect.logError('Lifetime cleanup failed', cause);

const exited = (fiber: Fiber.Fiber<unknown, unknown>) =>
	new Promise<void>((resolve) => fiber.addObserver(() => resolve()));

export class Lifetime {
	readonly #scope = Scope.makeUnsafe('parallel');
	readonly #fibers = new Set<Fiber.Fiber<unknown, unknown>>();
	readonly #scheduler: Scheduler | undefined;
	readonly #onCleanupFailure: (cause: Cause.Cause<unknown>) => Effect.Effect<void>;
	readonly #closed = Promise.withResolvers<void>();
	#ended = false;

	constructor({ scheduler, onCleanupFailure = logCleanupFailure }: LifetimeOptions = {}) {
		this.#scheduler = scheduler;
		this.#onCleanupFailure = onCleanupFailure;
	}

	get ended(): boolean {
		return this.#ended;
	}

	run<A, E>(effect: Effect.Effect<A, E, Scope.Scope>): Fiber.Fiber<A, E> {
		const admitted = Effect.withFiber((fiber) => {
			if (this.#ended) return Effect.interrupt;
			this.#fibers.add(fiber);
			fiber.addObserver(() => this.#fibers.delete(fiber));
			return effect;
		});
		return Effect.runFork(Scope.provide(admitted, this.#scope), { scheduler: this.#scheduler });
	}

	after(ms: number, fn: () => void): () => void {
		const fiber = this.run(
			Effect.sleep(ms).pipe(
				Effect.andThen(Effect.suspend(() => (this.#ended ? Effect.interrupt : Effect.sync(fn))))
			)
		);
		return () => fiber.interruptUnsafe();
	}

	end(): void {
		if (this.#ended) return;
		this.#ended = true;
		const fibers = [...this.#fibers];
		for (const fiber of fibers) fiber.interruptUnsafe();
		const cleanup = Scope.closeUnsafe(this.#scope, Exit.void);
		const pending = fibers.map(exited);
		if (cleanup) {
			const cleaning = Effect.runFork(
				cleanup.pipe(Effect.uninterruptible, Effect.catchCause(this.#onCleanupFailure)),
				{ scheduler: this.#scheduler }
			);
			pending.push(exited(cleaning));
		}
		void Promise.all(pending).then(() => this.#closed.resolve());
	}

	whenClosed(): Promise<void> {
		return this.#closed.promise;
	}
}
