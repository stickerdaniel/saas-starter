import * as Cause from 'effect/Cause';
import type * as Effect from 'effect/Effect';
import * as Exit from 'effect/Exit';
import { runClientEffect } from '../../effect/client-runtime.js';
import { getChatSessionEpoch, isChatSessionCurrent } from './chat-persisted-state.js';

export type SendClaim = {
	readonly owner: symbol;
	readonly epoch: number;
	readonly send: number;
};

type SendCommit<A> = {
	readonly success: (value: A) => void;
	readonly failure: (error: unknown) => void;
	readonly settle: () => void;
};

export class SendOwnership {
	readonly #owner = Symbol('SendOwnership');
	#send = 0;

	claim(): SendClaim {
		return { owner: this.#owner, epoch: getChatSessionEpoch(), send: ++this.#send };
	}

	supersede(): void {
		this.#send++;
	}

	owns(claim: SendClaim): boolean {
		return (
			claim.owner === this.#owner && claim.send === this.#send && isChatSessionCurrent(claim.epoch)
		);
	}

	async run<A>(
		claim: SendClaim,
		program: Effect.Effect<A, unknown>,
		commit: SendCommit<A>
	): Promise<A> {
		const running = runClientEffect(program);
		const exit = running instanceof Promise ? await running : running;
		try {
			if (Exit.isFailure(exit)) throw Cause.squash(exit.cause);
			if (this.owns(claim)) commit.success(exit.value);
			return exit.value;
		} catch (error) {
			if (this.owns(claim)) commit.failure(error);
			throw error;
		} finally {
			if (this.owns(claim)) commit.settle();
		}
	}
}
