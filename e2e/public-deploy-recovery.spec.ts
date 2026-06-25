import { expect, test } from '@playwright/test';

// The deploy-recovery contract: after a new deploy replaces content-hashed chunks,
// a dynamic import of a now-deleted hash makes Vite fire vite:preloadError. The root
// layout listens for it and hard reloads once to pull the fresh shell, recovering
// from what would otherwise be a blank page. A sessionStorage flag stops a reload
// loop if the shell itself is still served stale.
type SentinelWindow = Window & { __reloadSentinel?: boolean };

test.describe('deploy stale-chunk recovery', () => {
	test('a failed chunk preload triggers a single full reload', async ({ page }) => {
		// A light prerendered page: the home hero is a heavy WebGL scene that delays
		// hydration on a GPU-less CI runner, which would race the listener attaching.
		await page.goto('/en/privacy');

		// A full reload (what the backstop does) wipes this; a client update keeps it.
		await page.evaluate(() => {
			(window as SentinelWindow).__reloadSentinel = true;
		});

		// Fire vite:preloadError until hydration has wired the listener. It sets
		// sk:preload-reloaded and hard reloads once; the flag persists across the
		// reload, so the flag turning "1" proves the backstop ran. Re-firing is the
		// only reliable way to bridge the unknown hydration delay.
		await expect
			.poll(
				async () => {
					await page
						.evaluate(() => window.dispatchEvent(new Event('vite:preloadError')))
						.catch(() => {});
					return page
						.evaluate(() => sessionStorage.getItem('sk:preload-reloaded'))
						.catch(() => null);
				},
				{ timeout: 30_000, intervals: [250] }
			)
			.toBe('1');

		// The reload cleared the sentinel.
		await expect
			.poll(() =>
				page.evaluate(() => (window as SentinelWindow).__reloadSentinel).catch(() => undefined)
			)
			.toBeFalsy();

		// A second failure in the same tab must not reload again: the sessionStorage
		// guard short-circuits the listener, so the freshly set sentinel survives.
		await page.evaluate(() => {
			(window as SentinelWindow).__reloadSentinel = true;
		});
		for (let i = 0; i < 4; i++) {
			await page
				.evaluate(() => window.dispatchEvent(new Event('vite:preloadError')))
				.catch(() => {});
			await page.waitForTimeout(250);
		}
		expect(await page.evaluate(() => (window as SentinelWindow).__reloadSentinel)).toBe(true);
	});
});
