import { test as setup, expect } from '@playwright/test';

const adminAuthFile = 'e2e/.auth/admin.json';

/**
 * This setup test authenticates the admin test user and saves the session state.
 * Admin tests will use this authenticated state.
 *
 * The admin user is created and promoted to admin role via setup:test-users,
 * so no promotion is needed here - just sign in.
 *
 * Prerequisites:
 * 1. Set TEST_ADMIN_EMAIL and TEST_ADMIN_PASSWORD in .env.test
 * 2. Run: bun run setup:test-users (with dev server running)
 */
setup('signin with admin user credentials', async ({ page }) => {
	const email = process.env.TEST_ADMIN_EMAIL;
	const password = process.env.TEST_ADMIN_PASSWORD;

	if (!email || !password) {
		throw new Error(
			'TEST_ADMIN_EMAIL and TEST_ADMIN_PASSWORD must be set. ' +
				'Update .env.test with admin credentials, ' +
				'then run: bun run setup:test-users'
		);
	}

	// Go to signin page and wait for form to be ready
	await page.goto('/signin');
	await expect(page.locator('[data-testid="email-input"]')).toBeVisible({ timeout: 10000 });

	// Fill in admin credentials
	await page.fill('[data-testid="email-input"]', email);
	await page.fill('[data-testid="password-input"]', password);
	await page.click('[data-testid="signin-button"]');

	// Wait for redirect to app
	await page.waitForURL(/\/[a-z]{2}\/app/, { timeout: 15000 });

	// Verify we're authenticated
	await expect(page).toHaveURL(/\/app/);

	// Save authenticated state with admin role
	await page.context().storageState({ path: adminAuthFile });
});
