import { test as setup, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { waitForAuthenticated } from './utils/auth';

const authFile = 'e2e/.auth/user.json';

interface TestCredentials {
	user: { email: string; password: string; name: string };
	admin: { email: string; password: string; name: string };
	anonymousSupport: { userId: string; threadIds: string[] };
}

/**
 * This setup test authenticates the regular test user and saves the session state.
 * Other tests will reuse this authenticated state.
 *
 * Credentials are read from e2e/.auth/test-credentials.json (created by globalSetup).
 */
setup('signin with regular user credentials', async ({ page }) => {
	const credentialsPath = path.join(process.cwd(), 'e2e', '.auth', 'test-credentials.json');

	if (!fs.existsSync(credentialsPath)) {
		throw new Error('test-credentials.json not found. globalSetup may have failed.');
	}

	const credentials: TestCredentials = JSON.parse(fs.readFileSync(credentialsPath, 'utf-8'));
	const { email, password } = credentials.user;

	// Go to signin page and wait for form to be ready
	await page.goto('/signin');
	await expect(page.locator('[data-testid="email-input"]')).toBeVisible({ timeout: 30000 });

	// Fill in credentials using data-testid attributes
	await page.fill('[data-testid="email-input"]', email);
	await page.fill('[data-testid="password-input"]', password);

	// Click sign in button
	await page.click('[data-testid="signin-button"]');

	// Wait for authenticated state
	await waitForAuthenticated(page);

	// Save authenticated state (cookies)
	await page.context().storageState({ path: authFile });
});
