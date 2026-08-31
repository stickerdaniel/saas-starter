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
		expect(plan.delays.at(-1)).toBe(900);
		expect(plan.horizon).toBe(1_900);
	});

	it('returns no delays for an empty batch', () => {
		expect(planStreamingBatch(state({ horizon: 800 }), 0, 1_000)).toEqual({
			delays: [],
			horizon: 1_000
		});
	});
});
