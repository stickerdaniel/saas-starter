import { describe, expect, it, vi } from 'vitest';
import * as Effect from 'effect/Effect';
import { clearPersistedChatState } from './chat-persisted-state.ts';
import { SendOwnership, type SendClaim } from './send-ownership.ts';

const commit = () => ({ success: vi.fn(), failure: vi.fn(), settle: vi.fn() });

const settling = <A>(promise: Promise<A>) =>
	Effect.tryPromise({ try: () => promise, catch: (error) => error });

describe('SendOwnership', () => {
	it('owns a claim until a supersede, a newer claim or a session end', () => {
		const ownership = new SendOwnership();

		const first = ownership.claim();
		expect(ownership.owns(first)).toBe(true);
		ownership.supersede();
		expect(ownership.owns(first)).toBe(false);

		const second = ownership.claim();
		const third = ownership.claim();
		expect(ownership.owns(second)).toBe(false);
		expect(ownership.owns(third)).toBe(true);

		clearPersistedChatState();
		expect(ownership.owns(third)).toBe(false);
	});

	it('refuses a claim of another owner at an equal counter', async () => {
		const mine = new SendOwnership();
		const theirs = new SendOwnership();
		const claim = theirs.claim();
		mine.claim();
		const calls = commit();

		expect(mine.owns(claim)).toBe(false);
		await expect(mine.run(claim, Effect.succeed('value'), calls)).resolves.toBe('value');
		expect(calls.success).not.toHaveBeenCalled();
		expect(calls.settle).not.toHaveBeenCalled();
	});

	it('refuses a claim after a revision source changes and keeps it latest', () => {
		let generation = 0;
		let operation = 0;
		const ownership = new SendOwnership({
			generation: () => generation,
			operation: () => operation
		});

		const claim = ownership.claim();
		operation++;
		expect(ownership.owns(claim)).toBe(false);
		expect(ownership.isLatest(claim)).toBe(true);

		const next = ownership.claim();
		generation++;
		expect(ownership.owns(next)).toBe(false);
		generation--;
		expect(ownership.owns(next)).toBe(true);
		expect(ownership.isLatest(claim)).toBe(false);
	});

	it('releases every run before the owned settle', async () => {
		const ownership = new SendOwnership();
		const order: string[] = [];
		const calls = (name: string) => ({
			success: () => order.push(`${name}:success`),
			failure: () => order.push(`${name}:failure`),
			settle: () => order.push(`${name}:settle`),
			release: () => order.push(`${name}:release`)
		});
		const stale = Promise.withResolvers<string>();
		const staleRun = ownership.run(ownership.claim(), settling(stale.promise), calls('stale'));
		const owned = ownership.run(ownership.claim(), Effect.succeed('value'), calls('owned'));

		await expect(owned).resolves.toBe('value');
		stale.resolve('late');
		await expect(staleRun).resolves.toBe('late');

		expect(order).toEqual(['owned:success', 'owned:release', 'owned:settle', 'stale:release']);
	});

	it('passes a stale result and error through without a commit', async () => {
		const ownership = new SendOwnership();
		const defect = new Error('stale');
		const value = Promise.withResolvers<string>();
		const error = Promise.withResolvers<string>();
		const resolved = commit();
		const rejected = commit();

		const valueRun = ownership.run(ownership.claim(), settling(value.promise), resolved);
		const errorRun = ownership.run(ownership.claim(), settling(error.promise), rejected);
		ownership.supersede();
		value.resolve('value');
		error.reject(defect);

		await expect(valueRun).resolves.toBe('value');
		await expect(errorRun).rejects.toBe(defect);
		for (const calls of [resolved, rejected]) {
			expect(calls.success).not.toHaveBeenCalled();
			expect(calls.failure).not.toHaveBeenCalled();
			expect(calls.settle).not.toHaveBeenCalled();
		}
	});

	it.each([0, 1, 2, 3, 4, 5, 6, 7, 8])(
		'commits nothing once a supersede lands %i microtasks after the program settles',
		async (ticks) => {
			const ownership = new SendOwnership();
			const settled = Promise.withResolvers<string>();
			const claim: SendClaim = ownership.claim();
			const stale: string[] = [];
			const watch = (name: string) => () => {
				if (!ownership.owns(claim)) stale.push(name);
			};

			const run = ownership.run(claim, settling(settled.promise), {
				success: watch('success'),
				failure: watch('failure'),
				settle: watch('settle')
			});
			settled.resolve('value');
			for (let tick = 0; tick < ticks; tick++) await Promise.resolve();
			ownership.supersede();

			await expect(run).resolves.toBe('value');
			expect(stale).toEqual([]);
		}
	);
});
