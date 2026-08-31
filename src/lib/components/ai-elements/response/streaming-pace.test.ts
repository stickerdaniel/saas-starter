import { describe, expect, it } from 'vitest';
import { planStreamingBatch, type StreamingPaceState } from './streaming-pace.svelte.ts';

function state(overrides: Partial<StreamingPaceState> = {}): StreamingPaceState {
	return { horizon: 0, initialized: false, ...overrides };
}

describe('planStreamingBatch', () => {
	it('uses the source cadence for a small initial batch', () => {
		const plan = planStreamingBatch(state(), 4, 1_000);

		expect(plan.delays).toEqual([0, 60, 120, 180]);
		expect(plan.horizon).toBe(1_240);
	});

	it('bounds an initial backlog to a 400ms spread', () => {
		const plan = planStreamingBatch(state(), 101, 1_000);

		expect(plan.delays[0]).toBe(0);
		expect(plan.delays.at(-1)).toBe(400);
		expect(plan.horizon).toBe(1_400);
	});

	it('continues after the existing presentation horizon', () => {
		const plan = planStreamingBatch(state({ initialized: true, horizon: 1_180 }), 3, 1_000);

		expect(plan.delays).toEqual([180, 240, 300]);
		expect(plan.horizon).toBe(1_360);
	});

	it('compresses a large batch into the maximum lookahead', () => {
		const plan = planStreamingBatch(state({ initialized: true }), 100, 1_000);

		expect(plan.delays[0]).toBe(0);
		expect(plan.delays.at(-1)).toBe(891);
		expect(plan.horizon).toBe(1_900);
	});

	/**
	 * Capping each delay at the lookahead instead of dividing by it lands the tail
	 * of a large batch on one timestamp, and those words then appear together:
	 * the burst the scheduler exists to break up.
	 */
	it('keeps every reveal distinct once the lookahead is nearly spent', () => {
		const plan = planStreamingBatch(state({ initialized: true, horizon: 1_800 }), 40, 1_000);

		expect(new Set(plan.delays).size).toBe(40);
		const gaps = plan.delays.slice(1).map((delay, index) => delay - plan.delays[index]!);
		expect(new Set(gaps.map((gap) => gap.toFixed(6))).size).toBe(1);
	});

	/**
	 * A gap floor and the lookahead cap cannot both hold. Keeping the floor makes
	 * a fast model drift without bound (measured: 28s behind after 200 batches),
	 * so the floor is what gives and this is the guard that says so.
	 */
	it('holds the lookahead under sustained saturation', () => {
		const current = state({ initialized: true });
		for (let batch = 0; batch < 200; batch += 1) {
			const now = batch * 100;
			const plan = planStreamingBatch(current, 20, now);
			expect(plan.horizon - now).toBeLessThanOrEqual(900);
			expect(plan.delays.at(-1)!).toBeLessThan(900);
			current.horizon = plan.horizon;
		}
	});

	it('returns no delays for an empty batch', () => {
		expect(planStreamingBatch(state({ horizon: 800 }), 0, 1_000)).toEqual({
			delays: [],
			horizon: 1_000
		});
	});
});
