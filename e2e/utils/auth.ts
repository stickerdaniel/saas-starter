import { expect, type Page } from '@playwright/test';

/**
 * Wait for the app to be fully loaded with authenticated state.
 * Handles transient 500 errors in CI by retrying page load.
 *
 * 1. Wait for URL to match the app route
 * 2. Wait for network to be idle
 * 3. If 500 error, reload and retry (up to maxRetries)
 * 4. Wait for auth UI element
 */
export async function waitForAuthenticated(page: Page, timeout = 30000, maxRetries = 3) {
	for (let attempt = 1; attempt <= maxRetries; attempt++) {
		await page.waitForURL(/\/[a-z]{2}\/app/, { timeout });
		await page.waitForLoadState('networkidle', { timeout });

		const body = await page
			.locator('body')
			.textContent()
			.catch(() => '');
		const is500 = body?.includes('Internal Error') || body?.includes('500');

		if (is500) {
			if (attempt < maxRetries) {
				console.log(`[waitForAuthenticated] 500 error on attempt ${attempt}, retrying...`);
				await page.reload();
				continue;
			}
			throw new Error(`Server returned 500 after ${maxRetries} attempts`);
		}

		await expect(page.locator('#user-menu-trigger')).toBeVisible({ timeout });
		return;
	}
}
