import { test, expect } from '@playwright/test';

// This test runs without auth state - tests unauthenticated behavior
test.use({ storageState: { cookies: [], origins: [] } });

test('signin fails with invalid credentials', async ({ page }) => {
	await page.goto('/signin');

	// Wait for the page to load
	await page.waitForLoadState('networkidle');

	// Fill in invalid credentials
	await page.fill('[data-testid="email-input"]', 'invalid@example.com');
	await page.fill('[data-testid="password-input"]', 'wrongpassword123');

	// Submit the form
	await page.click('[data-testid="signin-button"]');

	// Should show error message (not redirect to app)
	await expect(page.locator('[data-testid="auth-error"]').first()).toBeVisible({ timeout: 10000 });

	// Should still be on signin page (any language prefix)
	await expect(page).toHaveURL(/\/.*\/signin|\/signin/);
});
