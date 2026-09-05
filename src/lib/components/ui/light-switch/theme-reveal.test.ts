/**
 * Lifecycle tests for the theme reveal, driven through a controllable stand-in
 * for the browser's ViewTransition.
 *
 * Three failure modes cost more than the animation. The circle opens away from
 * the toggle when the origin lands on the root before the pseudo-elements
 * exist. A transition settling after a second toggle strips the marker that
 * second reveal runs under. And an unwatched `updateCallbackDone` turns a
 * failed theme update into a page-level unhandled rejection while hiding the
 * error itself.
 */

import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { startThemeReveal } from './theme-reveal';

const MARKER = 'data-theme-transition';
const PROMISE_NAMES = ['ready', 'finished', 'updateCallbackDone'] as const;
const OUTCOMES = ['fulfil', 'reject'] as const;

type PromiseName = (typeof PROMISE_NAMES)[number];
type Outcome = (typeof OUTCOMES)[number];
type Settler = { promise: Promise<void>; fulfil: () => void; reject: (reason: unknown) => void };
type StartedTransition = Record<PromiseName, Settler> & { runUpdate: () => void };

function settler(): Settler {
	let fulfil!: () => void;
	let reject!: (reason: unknown) => void;
	const promise = new Promise<void>((resolve, rejectWith) => {
		fulfil = () => resolve();
		reject = rejectWith;
	});
	return { promise, fulfil, reject };
}

function settle(target: Settler, outcome: Outcome): void {
	if (outcome === 'fulfil') target.fulfil();
	else target.reject(new Error('transition settled as rejected'));
}

/**
 * Install a stand-in for `document.startViewTransition` and collect what it
 * hands back. jsdom implements none of the API.
 *
 * The settlement rules are the documented ones: `updateCallbackDone` mirrors the
 * update callback, and a callback that throws rejects `ready` and `finished`
 * with that same reason, because the new page state was never created.
 * https://developer.mozilla.org/en-US/docs/Web/API/ViewTransition/finished
 */
function stubViewTransitions(): StartedTransition[] {
	const started: StartedTransition[] = [];
	const start = (update: () => void) => {
		const promises = { ready: settler(), finished: settler(), updateCallbackDone: settler() };
		started.push({
			...promises,
			runUpdate: () => {
				try {
					update();
					promises.updateCallbackDone.fulfil();
				} catch (error) {
					for (const name of PROMISE_NAMES) promises[name].reject(error);
				}
			}
		});
		return {
			ready: promises.ready.promise,
			finished: promises.finished.promise,
			updateCallbackDone: promises.updateCallbackDone.promise
		};
	};
	document.startViewTransition = start as unknown as Document['startViewTransition'];
	return started;
}

/** A toggle centred on (150, 80), well away from the jsdom default of zero. */
function toggleAt(): HTMLElement {
	const button = document.createElement('button');
	vi.spyOn(button, 'getBoundingClientRect').mockReturnValue(new DOMRect(100, 40, 100, 80));
	return button;
}

/** Drain pending reactions and give Node its unhandled-rejection checkpoint. */
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** Every promise of the transition against both of its settlements. */
const SETTLEMENTS = PROMISE_NAMES.flatMap((promise) =>
	OUTCOMES.map((outcome) => ({ promise, outcome }))
);

const root = document.documentElement;
let unhandled: unknown[] = [];
let errorLog: MockInstance<typeof console.error>;
const captureUnhandled = (reason: unknown) => void unhandled.push(reason);

beforeEach(() => {
	unhandled = [];
	process.on('unhandledRejection', captureUnhandled);
	errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(async () => {
	await flush();
	const captured = unhandled.map(String);
	process.off('unhandledRejection', captureUnhandled);
	vi.restoreAllMocks();
	if ('startViewTransition' in document) delete (document as Partial<Document>).startViewTransition;
	root.removeAttribute(MARKER);
	root.removeAttribute('style');
	expect(captured).toEqual([]);
});

describe('theme reveal', () => {
	it('toggles at once and marks nothing where view transitions are missing', () => {
		const applyTheme = vi.fn();

		startThemeReveal(toggleAt(), applyTheme);

		expect(applyTheme).toHaveBeenCalledTimes(1);
		expect(root.hasAttribute(MARKER)).toBe(false);
		expect(root.style.getPropertyValue('--view-transition-x')).toBe('');
	});

	it('writes the toggle centre to the root only once ready fulfils', async () => {
		const started = stubViewTransitions();
		const applyTheme = vi.fn();

		startThemeReveal(toggleAt(), applyTheme);
		expect(root.hasAttribute(MARKER)).toBe(true);
		expect(root.style.getPropertyValue('--view-transition-x')).toBe('');

		started[0]!.runUpdate();
		expect(applyTheme).toHaveBeenCalledTimes(1);
		expect(root.style.getPropertyValue('--view-transition-x')).toBe('');

		settle(started[0]!.ready, 'fulfil');
		await flush();

		expect(root.style.getPropertyValue('--view-transition-x')).toBe('150px');
		expect(root.style.getPropertyValue('--view-transition-y')).toBe('80px');
		expect(root.hasAttribute(MARKER)).toBe(true);
	});

	it('gives overlapping toggles distinct marks', async () => {
		const started = stubViewTransitions();

		startThemeReveal(toggleAt(), vi.fn());
		const first = root.getAttribute(MARKER);
		startThemeReveal(toggleAt(), vi.fn());
		const second = root.getAttribute(MARKER);

		expect(first).not.toBeNull();
		expect(second).not.toBe(first);

		settle(started[0]!.finished, 'fulfil');
		await flush();
		expect(root.getAttribute(MARKER)).toBe(second);

		settle(started[1]!.finished, 'fulfil');
		await flush();
		expect(root.hasAttribute(MARKER)).toBe(false);
	});

	it.each(SETTLEMENTS)(
		'settles $promise as $outcome against its own mark alone',
		async ({ promise, outcome }) => {
			const started = stubViewTransitions();
			// Only the settlements that end the transition release the mark. The reveal
			// still runs while `ready` and `updateCallbackDone` fulfil.
			const keepsMark = outcome === 'fulfil' && promise !== 'finished';

			startThemeReveal(toggleAt(), vi.fn());
			const own = root.getAttribute(MARKER);

			settle(started[0]![promise], outcome);
			await flush();
			expect(root.getAttribute(MARKER)).toBe(keepsMark ? own : null);

			// A second toggle takes ownership, so every remaining settlement of the
			// first transition has to leave that newer mark in place.
			startThemeReveal(toggleAt(), vi.fn());
			const newer = root.getAttribute(MARKER);
			expect(newer).not.toBe(own);

			for (const name of PROMISE_NAMES) settle(started[0]![name], outcome);
			await flush();
			expect(root.getAttribute(MARKER)).toBe(newer);
		}
	);

	it('reports a failing theme update instead of dropping it', async () => {
		const started = stubViewTransitions();
		const failure = new Error('theme update failed');

		startThemeReveal(toggleAt(), () => {
			throw failure;
		});
		started[0]!.runUpdate();
		await flush();

		expect(errorLog).toHaveBeenCalledWith('Theme transition update failed:', failure);
		expect(root.hasAttribute(MARKER)).toBe(false);
	});
});
