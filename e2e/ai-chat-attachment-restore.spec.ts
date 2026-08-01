import { test, expect, type Page, type Route } from '@playwright/test';
import { waitForAuthenticated } from './utils/auth';

/**
 * A file that finished uploading is still attached after a reload.
 *
 * The draft text has always come back; the file next to it used to be the one
 * thing that did not, even though it was already in storage. Losing the page is
 * how most attachments were lost, so this is the flow that has to hold.
 *
 * Nothing here sends: what the restored tile carries into the message is the
 * fileId, and that is asserted in the unit tests rather than paid for with an
 * AI call.
 */

const NOTES = 'Attachment restore regression notes.\n';

/** Presigned storage endpoint, served by Convex rather than by a route in this repo. */
const STORAGE_UPLOAD = /\/api\/storage\/upload/;

function chip(page: Page) {
	return page.getByTestId('attachment-chip').first();
}

async function attachNotes(page: Page, name: string): Promise<void> {
	await page
		.locator('input[type="file"]')
		.first()
		.setInputFiles({ name, mimeType: 'text/plain', buffer: Buffer.from(NOTES, 'utf8') });
}

test.describe('AI chat attachment restore', () => {
	test.beforeEach(async ({ page }) => {
		await page.goto('/app/ai-chat');
		await waitForAuthenticated(page);
		await page.waitForURL(/\/app\/ai-chat\?thread=/, { timeout: 15000 });
		await expect(page.locator('textarea')).toBeVisible({ timeout: 10000 });
	});

	test('an uploaded file is still attached after a reload', async ({ page }) => {
		await attachNotes(page, 'restored.txt');
		await expect(chip(page)).toContainText('restored.txt', { timeout: 15000 });
		await expect(chip(page).getByRole('progressbar')).toBeHidden({ timeout: 30000 });
		await expect(chip(page)).not.toHaveAttribute('data-upload-failed', '');

		await page.reload();
		await waitForAuthenticated(page);
		await expect(page.locator('textarea')).toBeVisible({ timeout: 10000 });

		await expect(chip(page)).toContainText('restored.txt', { timeout: 15000 });
		await expect(chip(page)).not.toHaveAttribute('data-upload-failed', '');
	});

	test('a transfer that never finished is not offered back', async ({ page }) => {
		// Its bytes were in memory and nothing reached the server, so a tile after
		// the reload would stand for a file that does not exist.
		await page.route(STORAGE_UPLOAD, (_route: Route) => {
			// Deliberately unanswered: an upload that neither finishes nor fails.
		});
		await attachNotes(page, 'in-flight.txt');
		await expect(chip(page).getByRole('progressbar')).toBeVisible({ timeout: 15000 });

		await page.reload();
		await waitForAuthenticated(page);
		await expect(page.locator('textarea')).toBeVisible({ timeout: 10000 });
		await expect(page.getByTestId('attachment-chip')).toHaveCount(0);
	});
});
