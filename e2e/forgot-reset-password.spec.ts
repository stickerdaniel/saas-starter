import { test, expect } from '@playwright/test';

// This test runs without auth state - tests unauthenticated behavior
test.use({ storageState: { cookies: [], origins: [] } });

test.describe('Forgot Password', () => {
	test('shows validation error for invalid email', async ({ page }) => {
		await page.goto('/forgot-password');
		await page.waitForLoadState('domcontentloaded');
		await expect(page.getByTestId('forgot-password-email-input')).toBeEnabled({ timeout: 30000 });
		await expect(page.getByTestId('forgot-password-submit-button')).toBeEnabled({
			timeout: 30000
		});

		// Try to submit with invalid email (browser validation disabled with novalidate)
		await page.getByTestId('forgot-password-email-input').fill('notanemail');
		await page.getByTestId('forgot-password-submit-button').click();

		// Should show our styled validation error
		await expect(page.getByText(/valid email/i).first()).toBeVisible({ timeout: 5000 });

		// Should still be on forgot-password page
		await expect(page).toHaveURL(/forgot-password/);
	});

	test('shows success message after valid email submission', async ({ page }) => {
		await page.goto('/forgot-password');
		await page.waitForLoadState('domcontentloaded');
		await expect(page.getByTestId('forgot-password-email-input')).toBeEnabled({ timeout: 30000 });
		await expect(page.getByTestId('forgot-password-submit-button')).toBeEnabled({
			timeout: 30000
		});

		// Submit with valid email (doesn't need to exist for this test)
		await page.getByTestId('forgot-password-email-input').fill('test@example.com');
		await page.getByTestId('forgot-password-submit-button').click();

		// Should show success message (API returns success even for non-existent emails — security best practice)
		await expect(page.getByTestId('forgot-password-success-message')).toBeVisible({
			timeout: 10000
		});
	});

	test('navigates back to signin', async ({ page }) => {
		await page.goto('/forgot-password');
		await page.waitForLoadState('domcontentloaded');

		// Click back to sign in link
		await page.getByTestId('forgot-password-back-link').click();

		// Should navigate to signin
		await expect(page).toHaveURL(/signin/);
	});
});

test.describe('Reset Password', () => {
	test('shows error when token is missing', async ({ page }) => {
		await page.goto('/reset-password');
		await page.waitForLoadState('domcontentloaded');
		await expect(page.getByTestId('reset-password-password-input')).toBeEnabled({
			timeout: 30000
		});
		await expect(page.getByTestId('reset-password-submit-button')).toBeEnabled({
			timeout: 30000
		});

		// Fill in passwords
		await page.getByTestId('reset-password-password-input').fill('NewPassword123');
		await page.getByTestId('reset-password-confirm-input').fill('NewPassword123');

		// Submit
		await page.getByTestId('reset-password-submit-button').click();

		// Should show error about missing token
		const formError = page.getByTestId('reset-password-form-error');
		await expect(formError).toBeVisible({ timeout: 5000 });
	});

	test('shows validation error for password mismatch', async ({ page }) => {
		// Navigate with a dummy token (will fail on submit, but we can test client validation)
		await page.goto('/reset-password?token=dummy-token');
		await page.waitForLoadState('domcontentloaded');
		await expect(page.getByTestId('reset-password-password-input')).toBeEnabled({
			timeout: 30000
		});
		await expect(page.getByTestId('reset-password-submit-button')).toBeEnabled({
			timeout: 30000
		});

		// Fill in mismatched passwords
		await page.getByTestId('reset-password-password-input').fill('Password123');
		await page.getByTestId('reset-password-confirm-input').fill('DifferentPassword123');

		// Submit
		await page.getByTestId('reset-password-submit-button').click();

		// Should show mismatch error (translation key or default text)
		await expect(page.getByText(/match/i).first()).toBeVisible({
			timeout: 5000
		});
	});

	test('shows validation error for weak password', async ({ page }) => {
		await page.goto('/reset-password?token=dummy-token');
		await page.waitForLoadState('domcontentloaded');
		await expect(page.getByTestId('reset-password-password-input')).toBeEnabled({
			timeout: 30000
		});
		await expect(page.getByTestId('reset-password-submit-button')).toBeEnabled({
			timeout: 30000
		});

		// Fill in weak password (no uppercase)
		await page.getByTestId('reset-password-password-input').fill('weakpass1');
		await page.getByTestId('reset-password-confirm-input').fill('weakpass1');

		// Submit
		await page.getByTestId('reset-password-submit-button').click();

		// Should show password requirement errors
		await expect(
			page
				.getByText(/uppercase/i)
				.or(page.getByText(/character/i))
				.first()
		).toBeVisible({ timeout: 5000 });
	});

	test('navigates back to signin', async ({ page }) => {
		await page.goto('/reset-password?token=dummy');
		await page.waitForLoadState('domcontentloaded');

		// Click back to sign in link
		await page.getByTestId('reset-password-back-link').click();

		// Should navigate to signin
		await expect(page).toHaveURL(/signin/);
	});
});
