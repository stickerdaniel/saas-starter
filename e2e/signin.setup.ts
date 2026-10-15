import { test as setup } from '@playwright/test';
import { readTestCredentials, signInAsTestUser } from './utils/auth';

const authFile = 'e2e/.auth/user.json';

/**
 * This setup test authenticates the regular test user and saves the session state.
 * Other tests will reuse this authenticated state.
 *
 * Credentials are read from e2e/.auth/test-credentials.json (created by globalSetup).
 */
setup('signin with regular user credentials', async ({ page }) => {
	await signInAsTestUser(page, readTestCredentials().user);

	// Save authenticated state (cookies)
	await page.context().storageState({ path: authFile });
});
