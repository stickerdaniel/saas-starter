import * as Cause from 'effect/Cause';
import * as Effect from 'effect/Effect';
import * as Exit from 'effect/Exit';
import * as Fiber from 'effect/Fiber';

export type Claim = {
	readonly version: number;
	readonly wait: <B, E>(effect: Effect.Effect<B, E>) => Effect.Effect<B, E>;
};

export const runClientEffect = <A, E>(
	effect: Effect.Effect<A, E>
): Exit.Exit<A, E> | Promise<Exit.Exit<A, E>> => {
	const fiber = Effect.runFork(effect);
	return fiber.pollUnsafe() ?? new Promise((resolve) => fiber.addObserver(resolve));
};

export const observeClientEffect = <A, E>(
	effect: Effect.Effect<A, E>,
	onExit: (exit: Exit.Exit<A, E>) => void
): void => {
	const fiber = Effect.runFork(effect);
	const exit = fiber.pollUnsafe();
	if (exit) onExit(exit);
	else fiber.addObserver(onExit);
};

export class LatestFiber<A> {
	#current: Fiber.Fiber<unknown, unknown> | undefined;
	#version = 0;
	#closed = false;
	readonly #supersede: () => void;

	constructor(supersede: () => void = () => {}) {
		this.#supersede = supersede;
	}

	owns(claim: Claim): boolean {
		return this.#holds(claim.version);
	}

	guard(claim: Claim): Effect.Effect<void> {
		return Effect.suspend(() => (this.owns(claim) ? Effect.void : Effect.interrupt));
	}

	run<I>(program: (claim: Claim) => Effect.Effect<A>, interrupted: () => I): Promise<A | I> {
		const version = this.#claim();
		if (version === undefined) return Promise.resolve(interrupted());
		const fiber = Effect.runFork(
			Effect.withFiber((self) => {
				this.#current = self;
				return Effect.uninterruptibleMask((restore) => program({ version, wait: restore }));
			})
		);
		return Effect.runPromise(Fiber.await(fiber)).then((exit) => {
			if (Exit.isSuccess(exit)) return exit.value;
			if (Cause.hasInterruptsOnly(exit.cause)) return interrupted();
			throw Cause.squash(exit.cause);
		});
	}

	settle<B, E>(step: Effect.Effect<B, E>): Effect.Effect<B, E> {
		return Effect.withFiber((fiber) => {
			if (this.#current === fiber) this.#current = undefined;
			return step;
		});
	}

	close(): void {
		this.#closed = true;
		this.#supersede();
		this.#interrupt();
	}

	#claim(): number | undefined {
		while (!this.#closed) {
			const version = ++this.#version;
			this.#supersede();
			this.#interrupt();
			if (this.#holds(version)) return version;
		}
		return undefined;
	}

	#holds(version: number): boolean {
		return !this.#closed && this.#version === version;
	}

	#interrupt(): void {
		const current = this.#current;
		this.#current = undefined;
		current?.interruptUnsafe();
	}
}
