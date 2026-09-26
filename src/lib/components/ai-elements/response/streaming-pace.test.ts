import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount, tick, unmount } from 'svelte';
import type * as Svelte from 'svelte';
import { fromStore, writable } from 'svelte/store';
import type * as SvelteStore from 'svelte/store';
import Response from './Response.svelte';
import { streamingTextAnimation } from './streaming-animation.js';
import { planStreamingBatch, type StreamingPaceState } from './streaming-pace.svelte.ts';

// Vitest resolves Svelte's server entries by default; use its real client runtime for mounting.
vi.mock('svelte', () =>
	vi.importActual<typeof Svelte>('../../../../../node_modules/svelte/src/index-client.js')
);
vi.mock('svelte/store', () =>
	vi.importActual<typeof SvelteStore>(
		'../../../../../node_modules/svelte/src/store/index-client.js'
	)
);
vi.mock('esm-env', () => ({ BROWSER: true, DEV: true }));

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
 * The pacer finds the words it schedules in whatever svelte-streamdown emits,
 * which no public API promises, and carries its queue from one Convex snapshot
 * to the next. A renderer bump or selector edit that stops matching those
 * words, or a queue lost between snapshots, leaves every scheduling case above
 * green while words go back to appearing together or out of order.
 *
 * A word's reveal is the clock at its insertion plus its animation delay, so
 * the clock is fixed per snapshot to make that sum exact.
 */
describe('Response streaming presentation', () => {
	let component: ReturnType<typeof mount> | undefined;
	let clock = 0;

	beforeEach(() => {
		vi.spyOn(performance, 'now').mockImplementation(() => clock);
		vi.stubGlobal(
			'matchMedia',
			(query: string): MediaQueryList =>
				({
					matches: false,
					media: query,
					addEventListener: () => {},
					removeEventListener: () => {}
				}) as unknown as MediaQueryList
		);
	});

	afterEach(async () => {
		if (component) await unmount(component);
		component = undefined;
		document.body.replaceChildren();
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	function revealDelay(word: string): number {
		const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
		for (let node = walker.nextNode(); node; node = walker.nextNode()) {
			if (node.textContent?.trim() !== word) continue;
			return Number.parseFloat(getComputedStyle(node.parentElement!).animationDelay) || 0;
		}
		throw new Error(`"${word}" was not rendered`);
	}

	async function streamSnapshots(...snapshots: Array<{ at: number; content: string }>) {
		const content = writable(snapshots[0]!.content);
		const current = fromStore(content);
		const reveals = new Map<string, number>();

		for (const [index, snapshot] of snapshots.entries()) {
			clock = snapshot.at;
			if (index === 0) {
				component = mount(Response, {
					target: document.body,
					props: {
						get content() {
							return current.current;
						},
						animation: streamingTextAnimation(true)
					}
				});
			} else {
				content.set(snapshot.content);
			}
			await tick();
			await Promise.resolve();

			for (const word of snapshot.content.split(' ')) {
				if (!reveals.has(word)) reveals.set(word, snapshot.at + revealDelay(word));
			}
		}
		return [...reveals.values()];
	}

	function expectRevealedInOrder(reveals: number[]) {
		for (const [index, reveal] of reveals.entries()) {
			if (index > 0) expect(reveal).toBeGreaterThan(reveals[index - 1]!);
		}
	}

	it('staggers the words of a live batch instead of revealing them together', async () => {
		expectRevealedInOrder(await streamSnapshots({ at: 1_000, content: 'one two three' }));
	});

	it('reveals the next snapshot after the words still queued from the last', async () => {
		expectRevealedInOrder(
			await streamSnapshots(
				{ at: 1_000, content: 'one two three' },
				{ at: 1_020, content: 'one two three four five' }
			)
		);
	});
});
