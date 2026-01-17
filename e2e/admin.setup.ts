import { test as setup } from '@playwright/test';
import { ConvexHttpClient } from 'convex/browser';
import { api } from '../src/lib/convex/_generated/api';

const adminAuthFile = 'e2e/.auth/admin.json';

/**
 * This setup test promotes the test user to admin and saves a fresh auth state.
 * Admin tests will use this authenticated state.
 *
 * Prerequisites:
 * 1. Set TEST_USER_EMAIL, TEST_USER_PASSWORD, and AUTH_E2E_TEST_SECRET in .env.test
 * 2. Run: bun run setup:test-user (with dev server running)
 * 3. Set CONVEX_URL in .env.test (e.g., from `bunx convex dev`)
 */
setup('promote test user to admin', async ({ page }) => {
	const email = process.env.TEST_USER_EMAIL;
	const password = process.env.TEST_USER_PASSWORD;
	const testSecret = process.env.AUTH_E2E_TEST_SECRET;
	const convexUrl = process.env.PUBLIC_CONVEX_URL || process.env.VITE_CONVEX_URL;

	if (!email || !password) {
		throw new Error(
			'TEST_USER_EMAIL and TEST_USER_PASSWORD must be set. ' +
				'Update .env.test with test credentials, ' +
				'then run: bun run setup:test-user'
		);
	}

	if (!testSecret) {
		throw new Error('AUTH_E2E_TEST_SECRET must be set in .env.test');
	}

	if (!convexUrl) {
		throw new Error('PUBLIC_CONVEX_URL or VITE_CONVEX_URL must be set in .env.test');
	}

	// Promote test user to admin via Convex mutation
	const client = new ConvexHttpClient(convexUrl);
	const result = await client.mutation(api.tests.promoteTestUserToAdmin, {
		email,
		secret: testSecret
	});

	if (!result.success) {
		throw new Error(`Failed to promote test user to admin: ${result.error}`);
	}

	console.log(
		result.alreadyAdmin
			? `Test user ${email} is already an admin`
			: `Promoted test user ${email} to admin`
	);

	// Sign in to get fresh auth state with admin role in JWT
	await page.goto('/signin');
	await page.waitForLoadState('networkidle');

	await page.fill('[data-testid="email-input"]', email);
	await page.fill('[data-testid="password-input"]', password);
	await page.click('[data-testid="signin-button"]');

	// Wait for redirect to app
	await page.waitForURL(/\/[a-z]{2}\/app/, { timeout: 15000 });

	// Save authenticated state with admin role
	await page.context().storageState({ path: adminAuthFile });
});
