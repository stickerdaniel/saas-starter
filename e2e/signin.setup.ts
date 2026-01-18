import { test as setup, expect } from '@playwright/test';

const authFile = 'e2e/.auth/user.json';

/**
 * This setup test authenticates the regular test user and saves the session state.
 * Other tests will reuse this authenticated state.
 *
 * Prerequisites:
 * 1. Set TEST_USER_EMAIL and TEST_USER_PASSWORD in .env.test
 * 2. Run: bun run setup:test-users (with dev server running)
 */
setup('signin with regular user credentials', async ({ page }) => {
	const email = process.env.TEST_USER_EMAIL;
	const password = process.env.TEST_USER_PASSWORD;

	if (!email || !password) {
		throw new Error(
			'TEST_USER_EMAIL and TEST_USER_PASSWORD must be set. ' +
				'Update .env.test with test credentials, ' +
				'then run: bun run setup:test-users'
		);
	}

	// Go to signin page and wait for form to be ready
	await page.goto('/signin');
	await expect(page.locator('[data-testid="email-input"]')).toBeVisible({ timeout: 10000 });

	// Fill in credentials using data-testid attributes
	await page.fill('[data-testid="email-input"]', email);
	await page.fill('[data-testid="password-input"]', password);

	// Click sign in button
	await page.click('[data-testid="signin-button"]');

	// Wait for redirect to /en/app (indicates successful authentication)
	// The app uses language prefixes in URLs
	await page.waitForURL(/\/[a-z]{2}\/app/, { timeout: 15000 });

	// Verify we're authenticated by checking we're on the app page
	await expect(page).toHaveURL(/\/app/);

	// Save authenticated state (cookies)
	await page.context().storageState({ path: authFile });
});
