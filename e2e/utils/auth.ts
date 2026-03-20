import { expect, type Page } from '@playwright/test';

/**
 * Wait for the app to be fully loaded with authenticated state.
 * Handles transient app-load failures in CI by retrying page load.
 *
 * 1. Wait for URL to match the app route
 * 2. Wait for the authenticated UI shell
 * 3. If it does not appear, reload and retry (up to maxRetries)
 */
export async function waitForAuthenticated(page: Page, timeout = 30000, maxRetries = 3) {
	const perAttemptTimeout = Math.max(5000, Math.floor(timeout / maxRetries));

	for (let attempt = 1; attempt <= maxRetries; attempt++) {
		await page.waitForURL(/\/[a-z]{2}\/app/, { timeout });
		await page.waitForLoadState('domcontentloaded', { timeout });

		try {
			await expect(page.locator('#user-menu-trigger')).toBeVisible({ timeout: perAttemptTimeout });
			return;
		} catch (error) {
			if (attempt < maxRetries) {
				console.log(
					`[waitForAuthenticated] app shell not ready on attempt ${attempt}, retrying...`
				);
				await page.reload();
				continue;
			}
			throw error;
		}
	}
}
