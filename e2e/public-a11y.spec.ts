import { test, expect } from './utils/axe-test';

const pages = [
	{ name: 'marketing home', path: '/en' },
	{ name: 'signin', path: '/en/signin' },
	{ name: 'forgot password', path: '/en/forgot-password' },
	{ name: 'about', path: '/en/about' },
	{ name: 'pricing', path: '/en/pricing' },
	{ name: 'terms', path: '/en/terms' },
	{ name: 'privacy', path: '/en/privacy' }
];

for (const theme of ['light', 'dark'] as const) {
	test.describe(`Accessibility - Public Pages (${theme})`, () => {
		test.use({
			colorScheme: theme
		});

		for (const { name, path } of pages) {
			test(`${name} has no a11y violations`, async ({ page, makeAxeBuilder }) => {
				// Set ModeWatcher to the correct theme before navigating
				await page.addInitScript((t) => {
					localStorage.setItem('mode-watcher-mode', t);
				}, theme);
				// Cache-buster: CF Cache API ignores Vary: Accept, so a stale prior-deploy
				// HTML build (or a markdown body cached for the same URL by
				// public-agent-surface.spec.ts) can be served to this HTML navigation.
				// A unique cb per run forces a fresh origin fetch so axe audits the
				// current build.
				await page.goto(`${path}?cb=${Date.now()}`);

				// Settle before axe injects. page.goto resolves on the DOM `load`
				// event, but the client keeps working after that (SvelteKit
				// hydration, Convex/auth client bootstrap over the WebSocket).
				// networkidle waits past the HTTP part of hydration; #main-content
				// is server-rendered on every audited page (both layout groups), so
				// the auto-retrying assertion confirms the page actually rendered.
				await page.waitForLoadState('networkidle');
				await expect(page.locator('#main-content')).toBeVisible();

				// axe's analyze() runs many page.evaluate() passes; if the page's
				// execution context is torn down between two of them it throws
				// "Execution context was destroyed, most likely because of a
				// navigation". networkidle ignores WebSocket frames, so a late
				// socket-driven update can still trigger this; retry only that
				// specific error, re-settling between attempts. A real a11y
				// violation is returned in results, never thrown, so this cannot
				// mask one: violations are still asserted empty below.
				let results: Awaited<ReturnType<ReturnType<typeof makeAxeBuilder>['analyze']>> | undefined;
				for (let attempt = 0; attempt < 3; attempt++) {
					try {
						results = await makeAxeBuilder().analyze();
						break;
					} catch (error) {
						if (attempt < 2 && /Execution context was destroyed/.test(String(error))) {
							await page.waitForLoadState('networkidle');
							continue;
						}
						throw error;
					}
				}

				expect(results!.violations).toEqual([]);
			});
		}
	});
}
