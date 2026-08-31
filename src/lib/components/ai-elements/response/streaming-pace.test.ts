import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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
		expect(plan.horizon).toBe(1_404);
	});

	/**
	 * The horizon a batch leaves behind is when the next one may start, so ending
	 * it on the last reveal rather than one gap past hands that same instant to
	 * two words. Reachable on every thread opened while a reply is streaming: the
	 * backlog is the initial batch and the next Convex delta follows within
	 * throttle range.
	 */
	it('does not hand the next batch the last reveal of the backlog', () => {
		const backlog = planStreamingBatch(state(), 101, 1_000);
		const next = planStreamingBatch(
			state({ initialized: true, horizon: backlog.horizon }),
			5,
			1_100
		);

		const lastOfBacklog = 1_000 + backlog.delays.at(-1)!;
		expect(1_100 + next.delays[0]!).toBeGreaterThan(lastOfBacklog);
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

/**
 * The scheduler finds the words it paces through the inline style svelte-
 * streamdown writes on every animated span. That is an implementation detail of
 * a locked dependency, and nothing about it is part of a public API, so a bump
 * can drop it while every other test stays green: the spans would simply never
 * be found, the pacing would silently stop, and the stream would go back to
 * revealing whole Convex batches at once.
 *
 * Read the installed package rather than a copy of its output. A hand-written
 * fixture would keep agreeing with itself through exactly the release this
 * exists to catch.
 */
describe('svelte-streamdown animation contract', () => {
	const root = join(import.meta.dirname, '../../../../..');
	const read = (path: string) => readFileSync(join(root, path), 'utf8');

	const SELECTOR_SUBSTRING = 'animation-name: sd-';

	it('writes the animation name as an inline style', () => {
		const context = read('node_modules/svelte-streamdown/dist/context.svelte.js');

		expect(context).toContain(`\`${SELECTOR_SUBSTRING}\${this.animation.type};`);
	});

	it('puts that style on the per-word span', () => {
		const animatedText = read('node_modules/svelte-streamdown/dist/AnimatedText.svelte');

		expect(animatedText).toContain('<span style={streamdown.animationTextStyle}>');
	});

	// Both consumers match the same substring, and both stop working together.
	it('is the substring both consumers select on', () => {
		expect(read('src/lib/components/ai-elements/response/streaming-pace.svelte.ts')).toContain(
			`span[style*="${SELECTOR_SUBSTRING}"]`
		);
		expect(read('src/routes/layout.css')).toContain(`span[style*='${SELECTOR_SUBSTRING}']`);
	});
});
