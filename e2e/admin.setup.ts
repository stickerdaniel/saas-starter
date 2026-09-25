import { test as setup, expect } from '@playwright/test';
import { readTestCredentials, submitSignInForm, waitForAuthenticated } from './utils/auth';

const adminAuthFile = 'e2e/.auth/admin.json';

/**
 * This setup test authenticates the admin test user and saves the session state.
 * Admin tests will use this authenticated state.
 *
 * Credentials are read from e2e/.auth/test-credentials.json (created by globalSetup).
 */
setup('signin with admin user credentials', async ({ page }) => {
	const { email, password } = readTestCredentials().admin;

	// Go to signin page and wait for form to be ready
	await page.goto('/signin');
	await expect(page.locator('[data-testid="email-input"]')).toBeVisible({ timeout: 30000 });

	await submitSignInForm(page, email, password);

	// Wait for authenticated state
	await waitForAuthenticated(page);

	// Save authenticated state with admin role
	await page.context().storageState({ path: adminAuthFile });
});
