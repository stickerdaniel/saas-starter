import { test, expect } from '@playwright/test';

// Drives the auth forms as an anonymous visitor (no stored auth state).
test.use({ storageState: { cookies: [], origins: [] } });

test.describe('Auth form error a11y', () => {
	test('invalid email submit wires aria-invalid + aria-describedby to a live error', async ({
		page
	}) => {
		await page.goto('/signin');

		const email = page.getByTestId('email-input');
		const password = page.getByTestId('password-input');
		await expect(email).toBeEnabled({ timeout: 30000 });
		await expect(page.getByTestId('signin-button')).toBeEnabled({ timeout: 30000 });

		// Submit an invalid email so client-side validation marks the field.
		await email.fill('not-an-email');
		await password.fill('whatever');
		await page.getByTestId('signin-button').click();

		await expect(email).toHaveAttribute('aria-invalid', 'true');

		// The id in aria-describedby is generated at runtime; read it and assert the
		// referenced node is a visible, non-empty alert.
		const describedBy = await email.getAttribute('aria-describedby');
		expect(describedBy).toBeTruthy();

		const errorNode = page.locator(`#${describedBy}`);
		await expect(errorNode).toBeVisible();
		await expect(errorNode).toHaveAttribute('role', 'alert');
		await expect(errorNode).not.toBeEmpty();
	});

	test('a valid email leaves the field without aria-invalid', async ({ page }) => {
		await page.goto('/signin');

		const email = page.getByTestId('email-input');
		const password = page.getByTestId('password-input');
		await expect(email).toBeEnabled({ timeout: 30000 });
		await expect(page.getByTestId('signin-button')).toBeEnabled({ timeout: 30000 });

		// A well-formed email + non-empty password passes client-side validation,
		// so the email field must not be marked invalid.
		await email.fill('valid@example.com');
		await password.fill('SomePassword123!');
		await page.getByTestId('signin-button').click();

		await expect(email).not.toHaveAttribute('aria-invalid', 'true');
	});

	test('password strength and submit error OR-merge on signup, not overwrite', async ({ page }) => {
		await page.goto('/signup');

		const password = page.getByTestId('signup-password-input');
		await expect(password).toBeEnabled({ timeout: 30000 });
		await expect(page.getByTestId('signup-button')).toBeEnabled({ timeout: 30000 });

		// Pre-submit: a weak password trips the strength path → aria-invalid='true'.
		await password.fill('weak');
		await expect(password).toHaveAttribute('aria-invalid', 'true');

		// Submit with empty name/email keeps us on the form and adds the
		// submit-driven external invalid + describedby. The OR-merge must keep
		// aria-invalid='true' (strength path is not overwritten) and point
		// aria-describedby at the visible error.
		await page.getByTestId('signup-button').click();

		await expect(password).toHaveAttribute('aria-invalid', 'true');

		const describedBy = await password.getAttribute('aria-describedby');
		expect(describedBy).toBeTruthy();

		const errorNode = page.getByTestId('signup-password-error');
		await expect(errorNode).toBeVisible();
		await expect(errorNode).toHaveAttribute('id', describedBy!);
		await expect(errorNode).not.toBeEmpty();
	});
});
