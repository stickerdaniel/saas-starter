import { test, expect } from '@playwright/test';

// Uses pre-authenticated session state from setup
test('signout works', async ({ page }) => {
	// Already authenticated via session state - go directly to app
	await page.goto('/app');

	// Verify we're authenticated by being on the app page
	await expect(page).toHaveURL(/\/app/);

	// Click user menu and sign out
	await page.locator('#user-menu-trigger').click();
	await page.locator('[data-testid="logout-button"]').click();

	// Should redirect away from app after logout (to home or signin page)
	// With i18n, this could be /en, /en/signin, etc.
	await page.waitForURL(/.*\/[a-z]{2}(\/signin)?(\?.*)?$/, { timeout: 10000 });
});
