import { expect, type Route } from '@playwright/test';
import { test } from './utils/test';

// Cheaper layers rejected because: the landing sends no script preloads, so a
// visitor can click the demo button before the page hydrates. Only a browser that
// holds the scripts, follows the plain link to a new document and then loads that
// document's scripts shows whether support still opens. A request never runs them.
test('the demo button opens support when clicked before the landing hydrates', async ({ page }) => {
	const held: Route[] = [];
	await page.route('**/_app/immutable/**/*.js', (route) => {
		held.push(route);
	});

	await page.goto('/en', { waitUntil: 'domcontentloaded' });
	await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
	await expect.poll(() => held.length, { timeout: 10_000 }).toBeGreaterThan(0);
	await expect(page.locator('#svelte-announcer')).toHaveCount(0);

	await page.getByRole('link', { name: 'Request a demo' }).click({ noWaitAfter: true });
	await page.waitForURL('**/en?support=open', { waitUntil: 'commit', timeout: 10_000 });

	await page.unrouteAll({ behavior: 'ignoreErrors' });
	await Promise.allSettled(held.map((route) => route.fallback()));

	await expect(page.getByRole('button', { name: 'Close feedback' })).toBeVisible({
		timeout: 30_000
	});
});
