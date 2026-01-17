import { test, expect } from '@playwright/test';

/**
 * E2E tests for Admin Settings page - Notification Recipients
 *
 * Prerequisites:
 * - Test user must be an admin (promote via Convex dashboard if needed)
 * - Dev server running with Convex backend
 */
test.describe('Admin Settings Page', () => {
	test.beforeEach(async ({ page }) => {
		// Navigate to admin settings page
		await page.goto('/admin/settings');
		await page.waitForLoadState('networkidle');

		// Debug: log current URL and page title
		console.log('Current URL:', page.url());
		console.log('Page title:', await page.title());
	});

	test('displays recipients table', async ({ page }) => {
		// Debug: take screenshot
		await page.screenshot({ path: 'test-results/admin-settings-debug.png' });
		console.log('Page HTML:', await page.content());

		// Verify page loads
		await expect(page.getByTestId('admin-settings-page')).toBeVisible();
		await expect(page.getByTestId('recipients-table')).toBeVisible();

		// Wait for data to load (no more loading skeletons)
		await expect(page.getByTestId('recipients-loading')).not.toBeVisible({ timeout: 10000 });

		// Should have at least one recipient row (the admin user)
		const rows = page.locator('[data-testid^="recipient-row-"]');
		await expect(rows.first()).toBeVisible();
	});

	test('adds custom email recipient', async ({ page }) => {
		// Wait for table to load
		await expect(page.getByTestId('recipients-loading')).not.toBeVisible({ timeout: 10000 });

		// Generate unique email to avoid conflicts
		const testEmail = `test-e2e-${Date.now()}@example.com`;

		// Open add email dialog
		await page.getByTestId('add-email-button').click();

		// Fill in email
		await page.getByTestId('add-email-input').fill(testEmail);

		// Submit
		await page.getByTestId('add-email-submit').click();

		// Wait for dialog to close and verify email appears in table
		await expect(page.getByTestId('add-email-input')).not.toBeVisible({ timeout: 5000 });

		// Verify the new email appears in the table
		await expect(page.getByTestId(`recipient-row-${testEmail}`)).toBeVisible({ timeout: 5000 });
	});

	test('shows error for invalid email', async ({ page }) => {
		// Wait for table to load
		await expect(page.getByTestId('recipients-loading')).not.toBeVisible({ timeout: 10000 });

		// Open add email dialog
		await page.getByTestId('add-email-button').click();

		// Wait for dialog to open
		await expect(page.getByTestId('add-email-input')).toBeVisible();

		// Fill in invalid email (missing @ symbol triggers validation error)
		const invalidEmail = 'not-an-email';
		await page.getByTestId('add-email-input').fill(invalidEmail);

		// Verify submit button is enabled (not empty)
		await expect(page.getByTestId('add-email-submit')).toBeEnabled();

		// Submit the form
		await page.getByTestId('add-email-submit').click();

		// Verify error message appears (client-side validation catches missing @)
		// The regex /^[^\s@]+@[^\s@]+\.[^\s@]+$/ requires @ symbol
		await expect(page.getByTestId('add-email-error')).toBeVisible({ timeout: 5000 });
	});

	test('shows error for duplicate email', async ({ page }) => {
		// Wait for table to load
		await expect(page.getByTestId('recipients-loading')).not.toBeVisible({ timeout: 10000 });

		// First, add a custom email
		const testEmail = `test-dup-${Date.now()}@example.com`;

		await page.getByTestId('add-email-button').click();
		await page.getByTestId('add-email-input').fill(testEmail);
		await page.getByTestId('add-email-submit').click();

		// Wait for email to appear in table
		await expect(page.getByTestId(`recipient-row-${testEmail}`)).toBeVisible({ timeout: 5000 });

		// Try to add the same email again
		await page.getByTestId('add-email-button').click();
		await page.getByTestId('add-email-input').fill(testEmail);
		await page.getByTestId('add-email-submit').click();

		// Verify error message appears for duplicate email
		await expect(page.getByTestId('add-email-error')).toBeVisible({ timeout: 5000 });

		// Close dialog
		await page.keyboard.press('Escape');

		// Cleanup: remove the test email
		await page.getByTestId(`delete-email-${testEmail}`).click();
		await page.getByTestId('confirm-delete-button').click();
		await expect(page.getByTestId(`recipient-row-${testEmail}`)).not.toBeVisible({ timeout: 5000 });
	});

	test('filters recipients by type', async ({ page }) => {
		// Wait for table to load
		await expect(page.getByTestId('recipients-loading')).not.toBeVisible({ timeout: 10000 });

		// Get initial row count
		const allRows = page.locator('[data-testid^="recipient-row-"]');
		const initialCount = await allRows.count();

		// Skip if not enough data to test filtering
		if (initialCount < 1) {
			test.skip();
			return;
		}

		// Open filter dropdown
		await page.getByTestId('filter-type-trigger').click();

		// Select admin filter
		await page.getByTestId('filter-admin').click();

		// Verify filter is applied (clear button appears)
		await expect(page.getByTestId('filter-clear')).toBeVisible();

		// Clear filter
		await page.getByTestId('filter-clear').click();

		// Verify filter is cleared (clear button disappears)
		await expect(page.getByTestId('filter-clear')).not.toBeVisible();
	});

	test('toggles notification preference', async ({ page }) => {
		// Wait for table to load
		await expect(page.getByTestId('recipients-loading')).not.toBeVisible({ timeout: 10000 });

		// Find the first recipient row
		const firstRow = page.locator('[data-testid^="recipient-row-"]').first();
		await expect(firstRow).toBeVisible();

		// Get the email from the row's data-testid
		const rowTestId = await firstRow.getAttribute('data-testid');
		const email = rowTestId?.replace('recipient-row-', '');

		if (!email) {
			test.skip();
			return;
		}

		// Find a toggle checkbox for this recipient
		const toggle = page.getByTestId(`toggle-notifyNewSupportTickets-${email}`);

		if (!(await toggle.isVisible())) {
			test.skip();
			return;
		}

		// Get initial state
		const initialChecked = await toggle.isChecked();

		// Click to toggle
		await toggle.click();

		// Wait for state to change (more reliable than waitForTimeout)
		if (initialChecked) {
			await expect(toggle).not.toBeChecked({ timeout: 5000 });
		} else {
			await expect(toggle).toBeChecked({ timeout: 5000 });
		}

		// Toggle back to original state
		await toggle.click();

		// Wait for state to be restored
		if (initialChecked) {
			await expect(toggle).toBeChecked({ timeout: 5000 });
		} else {
			await expect(toggle).not.toBeChecked({ timeout: 5000 });
		}
	});

	test('removes custom email recipient', async ({ page }) => {
		// Wait for table to load
		await expect(page.getByTestId('recipients-loading')).not.toBeVisible({ timeout: 10000 });

		// First, add a custom email to remove
		const testEmail = `test-remove-${Date.now()}@example.com`;

		await page.getByTestId('add-email-button').click();
		await page.getByTestId('add-email-input').fill(testEmail);
		await page.getByTestId('add-email-submit').click();

		// Wait for email to appear
		await expect(page.getByTestId(`recipient-row-${testEmail}`)).toBeVisible({ timeout: 5000 });

		// Click delete button
		await page.getByTestId(`delete-email-${testEmail}`).click();

		// Confirm deletion in dialog - use specific testid
		await page.getByTestId('confirm-delete-button').click();

		// Wait for removal
		await expect(page.getByTestId(`recipient-row-${testEmail}`)).not.toBeVisible({
			timeout: 5000
		});
	});
});
