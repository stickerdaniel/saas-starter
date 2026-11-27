import * as Cause from 'effect/Cause';
import type * as Effect from 'effect/Effect';
import * as Exit from 'effect/Exit';
import { runClientEffect } from '../../effect/client-runtime.js';
import { getChatSessionEpoch, isChatSessionCurrent } from './chat-persisted-state.js';

export type SendClaim = {
	readonly owner: symbol;
	readonly epoch: number;
	readonly send: number;
	readonly revisions: readonly number[];
};

type SendCommit<A> = {
	readonly success: (value: A) => void;
	readonly failure: (error: unknown) => void;
	readonly settle: () => void;
	readonly release?: () => void;
};

export class SendOwnership {
	readonly #owner = Symbol('SendOwnership');
	readonly #revisions: ReadonlyArray<() => number>;
	#send = 0;

	constructor(revisions: Readonly<Record<string, () => number>> = {}) {
		this.#revisions = Object.values(revisions);
	}

	claim(): SendClaim {
		return {
			owner: this.#owner,
			epoch: getChatSessionEpoch(),
			send: ++this.#send,
			revisions: this.#revisions.map((read) => read())
		};
	}

	supersede(): void {
		this.#send++;
	}

	isLatest(claim: SendClaim): boolean {
		return claim.owner === this.#owner && claim.send === this.#send;
	}

	owns(claim: SendClaim): boolean {
		return (
			this.isLatest(claim) &&
			isChatSessionCurrent(claim.epoch) &&
			this.#revisions.every((read, index) => read() === claim.revisions[index])
		);
	}

	async run<A>(
		claim: SendClaim,
		program: Effect.Effect<A, unknown>,
		commit: SendCommit<A>
	): Promise<A> {
		const running = runClientEffect(program);
		return this.settle(claim, running instanceof Promise ? await running : running, commit);
	}

	settle<A>(claim: SendClaim, exit: Exit.Exit<A, unknown>, commit: SendCommit<A>): A {
		try {
			if (Exit.isFailure(exit)) throw Cause.squash(exit.cause);
			if (this.owns(claim)) commit.success(exit.value);
			return exit.value;
		} catch (error) {
			if (this.owns(claim)) commit.failure(error);
			throw error;
		} finally {
			commit.release?.();
			if (this.owns(claim)) commit.settle();
		}
	}
}
