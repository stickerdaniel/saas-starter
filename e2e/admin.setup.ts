import { test as setup } from '@playwright/test';
import { readTestCredentials, signInAsTestUser } from './utils/auth';

const adminAuthFile = 'e2e/.auth/admin.json';

/**
 * This setup test authenticates the admin test user and saves the session state.
 * Admin tests will use this authenticated state.
 *
 * Credentials are read from e2e/.auth/test-credentials.json (created by globalSetup).
 */
setup('signin with admin user credentials', async ({ page }) => {
	await signInAsTestUser(page, readTestCredentials().admin);

	// Save authenticated state with admin role
	await page.context().storageState({ path: adminAuthFile });
});
