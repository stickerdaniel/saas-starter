import { expect } from '@playwright/test';
import { test } from './utils/test';

/**
 * The theme toggle's circular reveal is a view transition, and the browser
 * captures its incoming snapshot the moment the update callback returns. The root
 * has to carry the new theme by then, or the reveal opens onto the theme it just
 * replaced. The switch flushes its own write, but mode-watcher still defers the
 * root class to a requestAnimationFrame unless the root layout's <ModeWatcher>
 * sets `synchronousModeChanges`.
 *
 * Cheaper layers rejected because: the defect lives in the browser's scheduling of
 * the real root layout. mode-watcher writes synchronously whenever it runs under
 * Vitest, so a jsdom mount cannot tell the layout's prop from its absence, and a
 * request-only check runs no script at all. No deployed backend is needed for the
 * failure to appear; this single light-page check is a deliberate, approved
 * exception that reuses the existing public project instead of adding a browser
 * lane. It costs one page load and one click, about 9s against the local dev stack.
 */

type Mode = 'dark' | 'light';
type Capture = { before: Mode; after: Mode };
type RevealEvent = { kind: 'requested' } | ({ kind: 'captured' } & Capture);
type RevealWindow = Window & { __themeReveal?: (event: RevealEvent) => Promise<void> };

test.use({ colorScheme: 'light' });

test('the theme reveal captures the theme it switches to', async ({ page }) => {
	// Count each requested transition synchronously, then record the root on entry
	// to the page's own update callback and at its exact return. The native API
	// still schedules, captures, and settles the transition; the wrapper only reads
	// the root around the callback it forwards.
	const reveal = { requested: 0, captures: [] as Capture[] };
	await page.exposeFunction('__themeReveal', (event: RevealEvent) => {
		if (event.kind === 'requested') reveal.requested += 1;
		else reveal.captures.push({ before: event.before, after: event.after });
	});
	await page.addInitScript(() => {
		const mode = (): Mode =>
			document.documentElement.classList.contains('dark') ? 'dark' : 'light';
		const report = (event: RevealEvent) => void (window as RevealWindow).__themeReveal?.(event);
		const recording = (update: ViewTransitionUpdateCallback): ViewTransitionUpdateCallback =>
			function (this: unknown, ...args: []) {
				const before = mode();
				const result = update.apply(this, args);
				report({ kind: 'captured', before, after: mode() });
				return result;
			};
		const native = Document.prototype.startViewTransition;
		Document.prototype.startViewTransition = function (
			this: Document,
			options?: ViewTransitionUpdateCallback | StartViewTransitionOptions,
			...rest: []
		) {
			report({ kind: 'requested' });
			const forwarded =
				typeof options === 'function'
					? recording(options)
					: options?.update
						? { ...options, update: recording(options.update) }
						: options;
			return native.call(this, forwarded, ...rest);
		};
	});

	// The privacy page carries the same header toggle without the home hero's WebGL.
	await page.goto(`/en/privacy?cb=${Date.now()}`);
	await expect(page.locator('html')).not.toHaveClass(/\bdark\b/);

	// A click that lands before hydration does nothing, so press the real control
	// only while no reveal has been requested. The hydrated handler requests its
	// transition synchronously, so once one is counted no further click is sent.
	// The budget covers the >10s hydration playwright.config.ts records for a cold
	// CI preview and still leaves the local 30s test budget room for navigation.
	const toggle = page.getByRole('button', { name: 'Toggle theme' });
	await expect(async () => {
		if (reveal.requested === 0) await toggle.click();
		expect(reveal.requested).toBeGreaterThan(0);
	}).toPass({ intervals: [250, 500, 1_000], timeout: 20_000 });

	// The browser runs the update callback later than the request; wait for it.
	await expect.poll(() => reveal.captures.length).toBe(1);

	expect(reveal.requested).toBe(1);
	expect(reveal.captures[0]).toEqual({ before: 'light', after: 'dark' });
	await expect(page.locator('html')).toHaveClass(/\bdark\b/);
});
