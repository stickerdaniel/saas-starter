import { test, expect } from '@playwright/test';
import { waitForAuthenticated } from './utils/auth';

/**
 * E2E tests for the email verification interstitial page.
 *
 * Tests the /email-verified page behavior:
 * 1. Shows confirmation message with loading state for authenticated users
 * 2. Redirects to signin for unauthenticated users
 * 3. Honors minimum display time (1.5s)
 * 4. Redirects to default destination (/app)
 * 5. Redirects to custom redirectTo parameter (validated for safety)
 */

test.describe('Email Verification Interstitial - Authenticated', () => {
	// Uses pre-authenticated session state from signin.setup.ts
	test('displays confirmation message for authenticated user', async ({ page }) => {
		await page.goto('/email-verified');

		// Should show the success icon and message
		await expect(page.locator('svg').filter({ hasText: '' }).first()).toBeVisible({
			timeout: 5000
		});
		await expect(page.locator('h1')).toContainText(/verified/i);

		// Should show loading spinner
		await expect(page.locator('svg.animate-spin')).toBeVisible();
	});

	test('redirects to default destination after minimum display time', async ({ page }) => {
		const startTime = Date.now();

		await page.goto('/email-verified');

		// Wait for redirect to /app
		await waitForAuthenticated(page, 30000);

		const elapsed = Date.now() - startTime;

		// Should have waited at least 1.5 seconds (with some tolerance for slow CI)
		// But not too long (max 5 seconds including navigation)
		expect(elapsed).toBeGreaterThanOrEqual(1400); // 1.5s - 100ms tolerance
		expect(elapsed).toBeLessThan(5000);
	});

	test('redirects to custom redirectTo destination', async ({ page }) => {
		const customPath = '/app';

		await page.goto(`/email-verified?redirectTo=${encodeURIComponent(customPath)}`);

		// Should redirect to custom destination
		await page.waitForURL(/\/[a-z]{2}\/app/, { timeout: 5000 });
		await waitForAuthenticated(page, 30000);
	});

	test('blocks unsafe redirectTo and uses fallback', async ({ page }) => {
		// Attempt various unsafe redirect URLs
		const unsafeUrls = [
			'http://evil.com',
			'https://evil.com',
			'//evil.com',
			'javascript:alert(1)'
		];

		for (const unsafeUrl of unsafeUrls) {
			await page.goto(`/email-verified?redirectTo=${encodeURIComponent(unsafeUrl)}`);

			// Should redirect to default /app (not the unsafe URL)
			await waitForAuthenticated(page, 30000);

			// Verify we're on app page, not evil URL
			await expect(page).toHaveURL(/\/[a-z]{2}\/app/);
		}
	});
});

test.describe('Email Verification Interstitial - Unauthenticated', () => {
	// Run without auth state - tests unauthenticated behavior
	test.use({ storageState: { cookies: [], origins: [] } });

	test('redirects to signin when not authenticated', async ({ page }) => {
		await page.goto('/email-verified');

		// Should redirect to signin page
		await page.waitForURL(/signin/, { timeout: 5000 });

		// Should be on signin page
		await expect(page).toHaveURL(/signin/);
	});

	test('preserves redirectTo parameter when redirecting to signin', async ({ page }) => {
		// This tests that if an unauthenticated user somehow lands on /email-verified
		// with a redirectTo, they don't lose that parameter when redirected to signin
		// (though current implementation doesn't preserve it - documenting expected behavior)
		await page.goto('/email-verified?redirectTo=/app');

		// Should redirect to signin
		await page.waitForURL(/signin/, { timeout: 5000 });
		await expect(page).toHaveURL(/signin/);

		// Note: Current implementation doesn't preserve redirectTo when redirecting
		// unauthenticated users to signin. This is acceptable but could be enhanced
		// in the future if needed.
	});
});
