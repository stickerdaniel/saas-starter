/**
 * Lifecycle tests for the theme reveal, driven through a controllable stand-in
 * for the browser's ViewTransition.
 *
 * Four failure modes cost more than the animation. The reveal opens onto the
 * theme it just replaced when mode-watcher writes the root class after the
 * update callback returns, which only the root layout's ModeWatcher
 * configuration keeps out of a `requestAnimationFrame`. The circle opens away
 * from the toggle when the origin lands on the root before the pseudo-elements
 * exist. A transition settling after a second toggle strips the marker that
 * second reveal runs under. And an unwatched `updateCallbackDone` turns a
 * failed theme update into a page-level unhandled rejection while hiding the
 * error itself.
 *
 * The first of those four has two halves. The switch's own flush is proved on
 * the real switch under the real ModeWatcher in the last describe. mode-watcher
 * writes the root class synchronously whenever it runs under Vitest, so the root
 * layout's half only fails in a real browser: e2e/public-theme-capture.spec.ts.
 */

import { mount, tick, unmount } from 'svelte';
import type * as Svelte from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { startThemeReveal } from './theme-reveal';
import ThemeRevealHarness from './test-fixtures/ThemeRevealHarness.svelte';

// Vitest resolves Svelte's server entry by default; use its real client runtime for mounting.
vi.mock('svelte', () =>
	vi.importActual<typeof Svelte>('../../../../../node_modules/svelte/src/index-client.js')
);
vi.mock('esm-env', () => ({ BROWSER: true, DEV: true }));
vi.mock('$lib/hooks/use-haptic.svelte.ts', () => ({ haptic: { trigger: vi.fn() } }));

const MARKER = 'data-theme-transition';
const PROMISE_NAMES = ['ready', 'finished', 'updateCallbackDone'] as const;

/** The document key the reveal counts its marks under, kept stable on purpose. */
const REVEAL_COUNT = Symbol.for('saas-starter.theme-reveal.count');

type PromiseName = (typeof PROMISE_NAMES)[number];
type Settler = { promise: Promise<void>; fulfil: () => void; reject: (reason: unknown) => void };
type StartedTransition = Record<PromiseName, Settler> & { runUpdate: () => void };
type CountedDocument = Document & { [REVEAL_COUNT]?: number };

function settler(): Settler {
	let fulfil!: () => void;
	let reject!: (reason: unknown) => void;
	const promise = new Promise<void>((resolve, rejectWith) => {
		fulfil = () => resolve();
		reject = rejectWith;
	});
	return { promise, fulfil, reject };
}

/** What Chromium rejects `ready` with once a transition has been skipped. */
const skipped = () => new DOMException('Transition was skipped', 'AbortError');

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

/**
 * The order Chromium runs when a second toggle starts while the first
 * transition is still live. Measured on the running app at `/en`: starting the
 * second transition skips the first, whose `ready` rejects with `AbortError`
 * before its own update callback has even run, and whose remaining promises
 * then all settle ahead of anything the second transition does.
 */
function rapidToggleLifecycle(first: StartedTransition, second: StartedTransition) {
	return [
		{ at: 'first ready rejects', run: () => first.ready.reject(skipped()) },
		{ at: 'first update callback', run: () => first.runUpdate() },
		{ at: 'first finished', run: () => first.finished.fulfil() },
		{ at: 'second update callback', run: () => second.runUpdate() },
		{ at: 'second ready', run: () => second.ready.fulfil() },
		{ at: 'second finished', run: () => second.finished.fulfil() }
	];
}

/** A toggle centred on the given point, well away from the jsdom default of zero. */
function toggleAt(centreX = 150, centreY = 80): HTMLElement {
	const button = document.createElement('button');
	vi.spyOn(button, 'getBoundingClientRect').mockReturnValue(
		new DOMRect(centreX - 50, centreY - 40, 100, 80)
	);
	return button;
}

/** Drain pending reactions and give Node its unhandled-rejection checkpoint. */
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

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
	delete (document as CountedDocument)[REVEAL_COUNT];
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

		started[0]!.ready.fulfil();
		await flush();

		expect(root.style.getPropertyValue('--view-transition-x')).toBe('150px');
		expect(root.style.getPropertyValue('--view-transition-y')).toBe('80px');
		expect(root.hasAttribute(MARKER)).toBe(true);
	});

	it('carries the newer mark through the measured rapid-toggle lifecycle', async () => {
		const started = stubViewTransitions();
		const applied: string[] = [];

		startThemeReveal(toggleAt(), () => void applied.push('first theme update'));
		const first = root.getAttribute(MARKER);
		startThemeReveal(toggleAt(400, 300), () => void applied.push('second theme update'));
		const second = root.getAttribute(MARKER);
		expect(first).not.toBeNull();
		expect(second).not.toBe(first);

		const observed: Array<{ at: string; mark: string | null }> = [];
		for (const step of rapidToggleLifecycle(started[0]!, started[1]!)) {
			step.run();
			await flush();
			observed.push({ at: step.at, mark: root.getAttribute(MARKER) });
		}

		// Both toggles change the theme, in the order they were pressed.
		expect(applied).toEqual(['first theme update', 'second theme update']);
		// Every settlement of the abandoned first transition leaves the mark the
		// second reveal runs under alone, and only that second reveal clears it.
		expect(observed).toEqual([
			{ at: 'first ready rejects', mark: second },
			{ at: 'first update callback', mark: second },
			{ at: 'first finished', mark: second },
			{ at: 'second update callback', mark: second },
			{ at: 'second ready', mark: second },
			{ at: 'second finished', mark: null }
		]);
		// The surviving reveal is the second one, so the root carries its origin.
		expect(root.style.getPropertyValue('--view-transition-x')).toBe('400px');
		expect(root.style.getPropertyValue('--view-transition-y')).toBe('300px');
	});

	it('drops the marker of a skipped transition without reporting it', async () => {
		const started = stubViewTransitions();

		startThemeReveal(toggleAt(), vi.fn());
		expect(root.hasAttribute(MARKER)).toBe(true);

		// A lone `AbortError` on `ready` is the documented shape of a skipped
		// transition: the update callback still runs and `finished` still fulfils.
		// There is no reveal left to scope, and nothing went wrong either.
		started[0]!.ready.reject(skipped());
		await flush();
		expect(root.hasAttribute(MARKER)).toBe(false);

		started[0]!.runUpdate();
		started[0]!.finished.fulfil();
		await flush();
		expect(root.hasAttribute(MARKER)).toBe(false);
		expect(errorLog).not.toHaveBeenCalled();
	});

	it('reports a failing theme update once instead of dropping it', async () => {
		const started = stubViewTransitions();
		const failure = new Error('theme update failed');

		startThemeReveal(toggleAt(), () => {
			throw failure;
		});
		started[0]!.runUpdate();
		await flush();

		expect(errorLog).toHaveBeenCalledTimes(1);
		expect(errorLog).toHaveBeenCalledWith('Theme transition update failed:', failure);
		expect(root.hasAttribute(MARKER)).toBe(false);
	});

	it('keeps a re-evaluated module off the mark of a pending transition', async () => {
		const started = stubViewTransitions();

		// Two evaluations of the same module, the second standing in for the HMR
		// update that replaces the first while its transition is still running.
		// Both are entered from the same starting point, which is the whole
		// hazard: a counter held in module scope restarts at zero on the second
		// evaluation and reissues the mark the pending transition still holds.
		vi.resetModules();
		const beforeUpdate = await import('./theme-reveal');
		beforeUpdate.startThemeReveal(toggleAt(), vi.fn());
		const pending = root.getAttribute(MARKER);

		vi.resetModules();
		const afterUpdate = await import('./theme-reveal');
		afterUpdate.startThemeReveal(toggleAt(), vi.fn());
		const fresh = root.getAttribute(MARKER);
		expect(fresh).not.toBe(pending);

		started[0]!.finished.fulfil();
		await flush();
		expect(root.getAttribute(MARKER)).toBe(fresh);
	});
});

describe('theme switch', () => {
	/** The key mode-watcher persists the chosen mode under. */
	const MODE_KEY = 'mode-watcher-mode';
	let harness: ReturnType<typeof mount> | undefined;

	afterEach(async () => {
		if (harness) await unmount(harness);
		harness = undefined;
		document.body.replaceChildren();
		localStorage.removeItem(MODE_KEY);
		localStorage.removeItem('mode-watcher-theme');
		root.classList.remove('dark');
		root.removeAttribute('data-theme');
	});

	it('has the root on the new theme when the reveal update callback returns', async () => {
		localStorage.setItem(MODE_KEY, 'light');
		const started = stubViewTransitions();
		harness = mount(ThemeRevealHarness, { target: document.body });
		await tick();
		expect(root.classList.contains('dark')).toBe(false);

		const toggle = [...document.querySelectorAll('button')].find(
			(button) => button.textContent?.trim() === 'Toggle theme'
		);
		toggle!.click();
		expect(started).toHaveLength(1);

		// The browser captures the incoming snapshot the moment the update callback
		// returns, so the root is read in the same task, before any queued Svelte
		// effect could still move it onto the new theme.
		started[0]!.runUpdate();
		const darkAtReturn = root.classList.contains('dark');

		started[0]!.ready.fulfil();
		started[0]!.finished.fulfil();
		await flush();
		expect(darkAtReturn).toBe(true);
		expect(localStorage.getItem(MODE_KEY)).toBe('dark');
	});
});
