import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { waitForAuthenticated } from './utils/auth';

test.use({ storageState: { cookies: [], origins: [] } });

interface TestCredentials {
	user: { email: string; password: string; name: string };
	admin: { email: string; password: string; name: string };
	anonymousSupport: { userId: string; threadIds: string[] };
}

function getUserCredentials() {
	const credentialsPath = path.join(process.cwd(), 'e2e', '.auth', 'test-credentials.json');
	if (!fs.existsSync(credentialsPath)) {
		throw new Error('test-credentials.json not found. globalSetup may have failed.');
	}

	const credentials: TestCredentials = JSON.parse(fs.readFileSync(credentialsPath, 'utf-8'));
	return credentials.user;
}

test('shows passkey last-used badge from local storage', async ({ page }) => {
	await page.addInitScript(() => {
		localStorage.setItem('auth:last-auth-method', JSON.stringify('passkey'));
		sessionStorage.removeItem('auth:pending-oauth-provider');
	});

	await page.goto('/signin');
	await expect(page.locator('[data-testid="email-input"]')).toBeVisible({ timeout: 30000 });

	await expect(page.locator('[data-testid="oauth-passkey-last-used-badge"]')).toBeVisible();
	await expect(page.locator('[data-testid="oauth-google-last-used-badge"]')).toHaveCount(0);
	await expect(page.locator('[data-testid="oauth-github-last-used-badge"]')).toHaveCount(0);
});

test('email/password signin clears stored last-used method', async ({ page }) => {
	await page.addInitScript(() => {
		localStorage.setItem('auth:last-auth-method', JSON.stringify('google'));
		sessionStorage.removeItem('auth:pending-oauth-provider');
	});

	await page.goto('/signin');
	await expect(page.locator('[data-testid="email-input"]')).toBeVisible({ timeout: 30000 });

	const hasGoogleOAuth =
		(await page.locator('[data-testid="signin-oauth-google-button"]').count()) > 0;
	test.skip(!hasGoogleOAuth, 'Google OAuth is disabled in this environment');

	await expect(page.locator('[data-testid="oauth-google-last-used-badge"]')).toBeVisible();

	const { email, password } = getUserCredentials();
	await page.fill('[data-testid="email-input"]', email);
	await page.fill('[data-testid="password-input"]', password);
	await page.click('[data-testid="signin-button"]');
	await waitForAuthenticated(page);

	const lastMethodAfterSignIn = await page.evaluate(() => {
		const raw = localStorage.getItem('auth:last-auth-method');
		return raw ? JSON.parse(raw) : null;
	});
	expect(lastMethodAfterSignIn).toBeNull();

	await page.context().clearCookies();
	await page.goto('/signin');
	await expect(page.locator('[data-testid="email-input"]')).toBeVisible({ timeout: 30000 });
	await expect(page.locator('[data-testid="oauth-google-last-used-badge"]')).toHaveCount(0);
	await expect(page.locator('[data-testid="oauth-github-last-used-badge"]')).toHaveCount(0);
	await expect(page.locator('[data-testid="oauth-passkey-last-used-badge"]')).toHaveCount(0);
});
