import { expect, test, type Page } from '@playwright/test';

// The deploy-recovery contract: after a new deploy replaces content-hashed chunks,
// a dynamic import of a now-deleted hash makes Vite fire vite:preloadError. The app
// shell listens for it and hard reloads once to pull the fresh shell, recovering
// from what would otherwise be a blank page. A sessionStorage flag stops a reload
// loop if the shell itself is still served stale.
type SentinelWindow = Window & {
	__reloadSentinel?: boolean;
	__deployReloadArmed?: boolean;
};

// Wait until the inline app shell has actually wired the reload backstop: it flips
// __deployReloadArmed true in the same block that adds the listener. Keying off
// this readiness flag is deterministic, unlike blind-firing vite:preloadError and
// hoping to land after hydration finishes.
async function waitForBackstop(page: Page) {
	await page.waitForFunction(
		() => (window as SentinelWindow).__deployReloadArmed === true,
		undefined,
		{ timeout: 30_000 }
	);
}

test.describe('deploy stale-chunk recovery', () => {
	test('a failed chunk preload triggers a single full reload', async ({ page }) => {
		// A light prerendered page: the home hero is a heavy WebGL scene that delays
		// hydration on a GPU-less CI runner, which would race the listener attaching.
		const response = await page.goto(`/en/privacy?cb=${Date.now()}`);
		expect(response?.headers()['content-type']).toContain('text/html');
		await waitForBackstop(page);

		// A full reload (what the backstop does) wipes this; a client update keeps it.
		await page.evaluate(() => {
			(window as SentinelWindow).__reloadSentinel = true;
		});

		// Fire vite:preloadError once the backstop is wired. It sets
		// sk:preload-reloaded and hard reloads once; the flag persists across the
		// reload, so the flag turning "1" proves the backstop ran.
		await page.evaluate(() => window.dispatchEvent(new Event('vite:preloadError')));
		await expect
			.poll(() =>
				page.evaluate(() => sessionStorage.getItem('sk:preload-reloaded')).catch(() => null)
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
