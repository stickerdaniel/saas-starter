import { expect, type Page } from '@playwright/test';

/**
 * Wait for the app to be fully loaded, hydrated, and authenticated.
 * Handles transient app-load failures in CI by retrying page load.
 *
 * 1. Wait for URL to match the app route
 * 2. Wait for the authenticated UI shell to be visible
 * 3. Wait for Svelte hydration (data-hydrated attribute on <html>)
 * 4. If the shell does not appear, reload and retry (up to maxRetries)
 *
 * After this returns, event handlers are attached and elements are interactive.
 */
export async function waitForAuthenticated(page: Page, timeout = 30000, maxRetries = 3) {
	const perAttemptTimeout = Math.max(5000, Math.floor(timeout / maxRetries));

	for (let attempt = 1; attempt <= maxRetries; attempt++) {
		await page.waitForURL(/\/[a-z]{2}\/app/, { timeout });
		await page.waitForLoadState('domcontentloaded', { timeout });

		try {
			await expect(page.locator('#user-menu-trigger')).toBeVisible({
				timeout: perAttemptTimeout
			});
			// Wait for Svelte hydration to complete so event handlers are attached.
			// The app layout sets data-hydrated on <html> in onMount.
			await page.locator('html[data-hydrated]').waitFor({ timeout: perAttemptTimeout });
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
