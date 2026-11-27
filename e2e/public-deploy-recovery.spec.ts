import { expect, type Page } from '@playwright/test';
import { test } from './utils/test';

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

// Cheaper layers rejected because: the reload follows a real failed dynamic import
// on the landing, which only a browser that runs the landing's scripts produces.
test.describe('deploy stale-chunk recovery on the landing', () => {
	const FAILED_IMPORT =
		/^Failed to fetch dynamically imported module: \S+\/_app\/immutable\/\S+\.js$/;
	test.use({ allowedClientErrors: [FAILED_IMPORT] });

	test('a missing support chunk reloads the landing once and support opens', async ({
		page,
		clientErrors
	}) => {
		const documents = new Set<number>();
		const preloadErrors: number[] = [];
		await page.exposeBinding('__e2eRecoveryProbe', ({ frame }, kind: string, origin: number) => {
			if (frame !== page.mainFrame()) return;
			if (kind === 'document') documents.add(origin);
			if (kind === 'preloadError') preloadErrors.push(origin);
		});
		await page.addInitScript(() => {
			const report = (window as unknown as Record<string, (kind: string, origin: number) => void>)
				.__e2eRecoveryProbe;
			report('document', performance.timeOrigin);
			window.addEventListener('vite:preloadError', () =>
				report('preloadError', performance.timeOrigin)
			);
		});

		let failedUrl: string | null = null;
		let notFoundCount = 0;
		await page.route('**/_app/immutable/**/*.js', async (route) => {
			if (failedUrl) return route.fallback();
			const response = await route.fetch();
			const body = await response.text();
			if (!failedUrl && body.includes('support.screenshot.error.email_subject')) {
				failedUrl = route.request().url();
				notFoundCount += 1;
				return route.fulfill({ status: 404, body: '' });
			}
			return route.fulfill({ response, body });
		});

		await page.goto('/en?support=open');
		await expect(page.getByRole('button', { name: 'Close feedback' })).toBeVisible({
			timeout: 30_000
		});
		await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
		expect(failedUrl).not.toBeNull();
		expect(notFoundCount).toBe(1);

		await expect.poll(() => preloadErrors.length).toBe(1);
		const [firstDocument] = documents;
		expect(preloadErrors[0]).toBe(firstDocument);
		await page.waitForTimeout(3_000);
		expect(documents.size).toBe(2);
		expect(await page.evaluate(() => sessionStorage.getItem('sk:preload-reloaded'))).toBe('1');

		const failedImports = clientErrors.filter((message) => FAILED_IMPORT.test(message));
		expect(failedImports.length).toBeLessThanOrEqual(1);
		expect(failedImports.every((message) => message.endsWith(failedUrl ?? ''))).toBe(true);
	});
});
