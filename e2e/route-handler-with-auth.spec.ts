import { test, expect } from '@playwright/test';

test.describe('authenticated API access', () => {
	// Uses pre-authenticated session state from setup

	test('route handler returns 200 when authenticated', async ({ page }) => {
		const response = await page.goto('/api/');

		expect(response).not.toBeNull();
		expect(response?.status()).toBe(200);
	});
});

test.describe('unauthenticated API access', () => {
	// Clear auth state for these tests
	test.use({ storageState: { cookies: [], origins: [] } });

	test('route handler returns 403 when not authenticated', async ({ page }) => {
		const response = await page.goto('/api/');

		expect(response).not.toBeNull();
		expect(response?.status()).toBe(403);
	});
});
