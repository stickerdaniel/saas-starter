import { expect } from '@playwright/test';
import { test } from './utils/test';

// Cheaper layers rejected because: the failure is a module that reads storage on
// import and stops hydration of the built page. Only a browser that loads the
// deployed bundle with blocked storage shows whether the page still hydrates. A
// request never runs the scripts.
test('the landing hydrates when the browser blocks site storage', async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await page.addInitScript(() => {
		for (const name of ['localStorage', 'sessionStorage']) {
			Object.defineProperty(window, name, {
				configurable: true,
				get() {
					throw new DOMException('The operation is insecure.', 'SecurityError');
				}
			});
		}
	});

	await page.goto('/en');
	await expect(page.locator('#svelte-announcer')).toBeAttached({ timeout: 30_000 });
	await page.getByRole('button', { name: 'Open Menu' }).click();

	await expect(page.locator('#marketing-mobile-menu')).toBeVisible();
	await expect(page.getByRole('button', { name: 'Close Menu' })).toBeVisible();
});
