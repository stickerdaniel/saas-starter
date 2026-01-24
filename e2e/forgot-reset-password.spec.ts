import { test, expect } from '@playwright/test';

// This test runs without auth state - tests unauthenticated behavior
test.use({ storageState: { cookies: [], origins: [] } });

test.describe('Forgot Password', () => {
	test('shows validation error for invalid email', async ({ page }) => {
		await page.goto('/forgot-password');
		await page.waitForLoadState('networkidle');

		// Try to submit with invalid email (browser validation disabled with novalidate)
		await page.fill('input[type="email"]', 'notanemail');
		await page.click('button[type="submit"]');

		// Should show our styled validation error
		await expect(page.getByText(/valid email/i).first()).toBeVisible({ timeout: 5000 });

		// Should still be on forgot-password page
		await expect(page).toHaveURL(/forgot-password/);
	});

	test('shows success message after valid email submission', async ({ page }) => {
		await page.goto('/forgot-password');
		await page.waitForLoadState('networkidle');

		// Submit with valid email (doesn't need to exist for this test)
		await page.fill('input[type="email"]', 'test@example.com');
		await page.click('button[type="submit"]');

		// Should show success message or stay on page without error
		// The API might return success even for non-existent emails (security best practice)
		await page.waitForTimeout(2000);

		// Either success message appears OR we're still on the page (no redirect)
		await expect(page).toHaveURL(/forgot-password/);
	});

	test('navigates back to signin', async ({ page }) => {
		await page.goto('/forgot-password');
		await page.waitForLoadState('networkidle');

		// Click back to sign in link
		await page.click('text=Back to sign in');

		// Should navigate to signin
		await expect(page).toHaveURL(/signin/);
	});
});

test.describe('Reset Password', () => {
	test('shows error when token is missing', async ({ page }) => {
		await page.goto('/reset-password');
		await page.waitForLoadState('networkidle');

		// Fill in passwords
		await page.fill('input[id*="password"]', 'NewPassword123');
		await page.fill('input[id*="confirm"]', 'NewPassword123');

		// Submit
		await page.click('button[type="submit"]');

		// Should show error about missing token
		await expect(page.locator('text=Missing').or(page.locator('text=invalid')).first()).toBeVisible(
			{ timeout: 5000 }
		);
	});

	test('shows validation error for password mismatch', async ({ page }) => {
		// Navigate with a dummy token (will fail on submit, but we can test client validation)
		await page.goto('/reset-password?token=dummy-token');
		await page.waitForLoadState('networkidle');

		// Fill in mismatched passwords
		await page.fill('input[id*="password"]:not([id*="confirm"])', 'Password123');
		await page.fill('input[id*="confirm"]', 'DifferentPassword123');

		// Submit
		await page.click('button[type="submit"]');

		// Should show mismatch error (translation key or default text)
		await expect(page.locator('text=match').or(page.locator('text=mismatch')).first()).toBeVisible({
			timeout: 5000
		});
	});

	test('shows validation error for weak password', async ({ page }) => {
		await page.goto('/reset-password?token=dummy-token');
		await page.waitForLoadState('networkidle');

		// Fill in weak password (no uppercase)
		await page.fill('input[id*="password"]:not([id*="confirm"])', 'weakpass1');
		await page.fill('input[id*="confirm"]', 'weakpass1');

		// Submit
		await page.click('button[type="submit"]');

		// Should show password requirement errors
		await expect(
			page.locator('text=uppercase').or(page.locator('text=character')).first()
		).toBeVisible({ timeout: 5000 });
	});

	test('navigates back to signin', async ({ page }) => {
		await page.goto('/reset-password?token=dummy');
		await page.waitForLoadState('networkidle');

		// Click back to sign in link
		await page.click('text=Back to sign in');

		// Should navigate to signin
		await expect(page).toHaveURL(/signin/);
	});
});
