import { test, expect } from '@playwright/test';
import 'varlock/auto-load';
import { ConvexHttpClient } from 'convex/browser';
import { api } from '../src/lib/convex/_generated/api';
import { resolveConvexUrl } from './utils/convex-url';
import { waitForAuthenticated } from './utils/auth';

// This test runs without auth state - drives the signup form as a new visitor
test.use({ storageState: { cookies: [], origins: [] } });

const TEST_PASSWORD = 'TestPassword123!';

test.describe('Signup form', () => {
	const testSecret = process.env.AUTH_E2E_TEST_SECRET;
	const convexUrl = resolveConvexUrl();
	const signupEmail = `signup-form-${Date.now()}@e2e.example.com`;

	let client: ConvexHttpClient;

	test.beforeAll(() => {
		if (!testSecret) {
			throw new Error('AUTH_E2E_TEST_SECRET is required in .env.test');
		}
		if (!convexUrl) {
			throw new Error(
				'Convex URL not configured (set PUBLIC_CONVEX_URL or start local dev server)'
			);
		}

		client = new ConvexHttpClient(convexUrl);
	});

	test.afterAll(async () => {
		if (!testSecret || !client) return;

		try {
			await client.mutation(api.tests.deleteTestUser, {
				email: signupEmail,
				secret: testSecret
			});
		} catch (error) {
			console.warn(`[signup] cleanup failed for ${signupEmail}:`, error);
		}
	});

	test('signup form creates an account that can sign in once verified', async ({ page }) => {
		await page.goto('/signup');
		await page.waitForLoadState('domcontentloaded');

		// Inputs stay disabled until hydration completes (isFormDisabled in SignUpForm)
		await expect(page.getByTestId('signup-name-input')).toBeEnabled({ timeout: 30000 });
		await expect(page.getByTestId('signup-button')).toBeEnabled({ timeout: 30000 });

		await page.getByTestId('signup-name-input').fill('Signup Form User');
		await page.getByTestId('signup-email-input').fill(signupEmail);
		await page.getByTestId('signup-password-input').fill(TEST_PASSWORD);
		await page.getByTestId('signup-button').click();

		// Successful signup swaps the form for the verification step
		await expect(page.getByTestId('signup-verification-step')).toBeVisible({ timeout: 15000 });
		await expect(page.getByTestId('auth-error')).toHaveCount(0);

		// The account now exists, so the verification step returns to sign in rather
		// than reopening a signup form that can only fail with a duplicate account.
		await page.getByRole('link', { name: 'Back to login' }).click();
		await expect(page).toHaveURL(/\/en\/signin$/);
		await expect(page.getByTestId('email-input')).toHaveValue(signupEmail);

		// Verify the email out of band (the real flow clicks a link in the verification email)
		const result = await client.mutation(api.tests.verifyTestUserEmail, {
			email: signupEmail,
			secret: testSecret!
		});
		expect(result.success).toBe(true);

		// The account created through the form can sign in through the form
		await expect(page.getByTestId('signin-button')).toBeEnabled({ timeout: 30000 });

		await page.getByTestId('password-input').fill(TEST_PASSWORD);
		await page.getByTestId('signin-button').click();

		await waitForAuthenticated(page);
	});
});
