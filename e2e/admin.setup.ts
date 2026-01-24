import { test as setup, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { waitForAuthenticated } from './utils/auth';

const adminAuthFile = 'e2e/.auth/admin.json';

interface TestCredentials {
	user: { email: string; password: string; name: string };
	admin: { email: string; password: string; name: string };
	anonymousSupport: { userId: string; threadId: string };
}

/**
 * This setup test authenticates the admin test user and saves the session state.
 * Admin tests will use this authenticated state.
 *
 * Credentials are read from e2e/.auth/test-credentials.json (created by globalSetup).
 */
setup('signin with admin user credentials', async ({ page }) => {
	const credentialsPath = path.join(process.cwd(), 'e2e', '.auth', 'test-credentials.json');

	if (!fs.existsSync(credentialsPath)) {
		throw new Error('test-credentials.json not found. globalSetup may have failed.');
	}

	const credentials: TestCredentials = JSON.parse(fs.readFileSync(credentialsPath, 'utf-8'));
	const { email, password } = credentials.admin;

	// Go to signin page and wait for form to be ready
	await page.goto('/signin');
	await expect(page.locator('[data-testid="email-input"]')).toBeVisible({ timeout: 30000 });

	// Fill in admin credentials
	await page.fill('[data-testid="email-input"]', email);
	await page.fill('[data-testid="password-input"]', password);
	await page.click('[data-testid="signin-button"]');

	// Wait for authenticated state
	await waitForAuthenticated(page);

	// Save authenticated state with admin role
	await page.context().storageState({ path: adminAuthFile });
});
