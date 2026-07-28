import { test, expect, type Page } from '@playwright/test';
import { waitForAuthenticated } from './utils/auth';

/**
 * A dropped upload used to leave a four-second toast and nothing else, so a
 * reload or a glance away lost the file with no trace. These assert the two
 * properties that prevent that: the failure persists, and it can be recovered
 * from without re-picking the file.
 */

const NOTES = 'Upload failure regression notes.\n';

/**
 * The presigned storage endpoint. It is served by the Convex deployment, not
 * the app origin, so this matches on the path the backend hands out rather than
 * on a route in this repo.
 */
const STORAGE_UPLOAD = /\/api\/storage\/upload/;

/** Attach a text file through the hidden input the composer renders. */
async function attachNotes(page: Page, name: string) {
	await page
		.locator('input[type="file"]')
		.first()
		.setInputFiles({ name, mimeType: 'text/plain', buffer: Buffer.from(NOTES, 'utf8') });
}

test.describe('AI Chat - upload failure', () => {
	test.beforeEach(async ({ page }) => {
		await page.goto('/app/ai-chat');
		await waitForAuthenticated(page);
		await page.waitForURL(/\/app\/ai-chat\?thread=/, { timeout: 15000 });
		await expect(page.locator('textarea')).toBeVisible({ timeout: 10000 });
	});

	test('a failed upload stays visible and blocks sending until resolved', async ({ page }) => {
		// Kill the storage POST only. Presign and commit stay reachable, so this
		// exercises the transport failure a flaky connection produces.
		await page.route(STORAGE_UPLOAD, (route) => route.abort('connectionfailed'));

		await attachNotes(page, 'dropped.txt');

		const alert = page.getByTestId('attachment-upload-error');
		await expect(alert).toBeVisible({ timeout: 20000 });
		await expect(alert).toContainText('dropped.txt');

		// The point of the fix: unlike a toast, it is still there later.
		await page.waitForTimeout(6000);
		await expect(alert).toBeVisible();

		// Sending would render an attachment the backend never received.
		await page.locator('textarea').fill('Here are my notes');
		await expect(page.getByTestId('attachment-upload-error')).toBeVisible();
		await expect(page.locator('[data-upload-failed]')).toBeVisible();
	});

	test('retry recovers the attachment once the connection is back', async ({ page }) => {
		let failNext = true;
		await page.route(STORAGE_UPLOAD, async (route) => {
			if (failNext) {
				failNext = false;
				await route.abort('connectionfailed');
				return;
			}
			await route.continue();
		});

		await attachNotes(page, 'recovered.txt');

		const alert = page.getByTestId('attachment-upload-error');
		await expect(alert).toBeVisible({ timeout: 20000 });

		await alert.getByRole('button').click();

		// Recovery is complete when the error is gone and the chip became
		// openable, which only happens once the upload has committed.
		await expect(alert).toBeHidden({ timeout: 20000 });
		await expect(page.getByTestId('attachment-chip').first()).toHaveAttribute('role', 'button', {
			timeout: 20000
		});
	});
});
