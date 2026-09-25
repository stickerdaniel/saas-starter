import { test as setup, expect } from '@playwright/test';
import { readTestCredentials, submitSignInForm, waitForAuthenticated } from './utils/auth';

const authFile = 'e2e/.auth/user.json';

/**
 * This setup test authenticates the regular test user and saves the session state.
 * Other tests will reuse this authenticated state.
 *
 * Credentials are read from e2e/.auth/test-credentials.json (created by globalSetup).
 */
setup('signin with regular user credentials', async ({ page }) => {
	const { email, password } = readTestCredentials().user;

	// Go to signin page and wait for form to be ready
	await page.goto('/signin');
	await expect(page.locator('[data-testid="email-input"]')).toBeVisible({ timeout: 30000 });

	await submitSignInForm(page, email, password);

	// Wait for authenticated state
	await waitForAuthenticated(page);

	// Save authenticated state (cookies)
	await page.context().storageState({ path: authFile });
});
