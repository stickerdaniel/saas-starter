import { test, expect } from '@playwright/test';
import { waitForAuthenticated } from './utils/auth';

const MARKDOWN = `# Preview Heading

A paragraph with a [safe link](https://example.com) and an ![tracker](https://example.com/pixel.png).

- first item
- second item
`;

test.describe('AI Chat - attachment text preview', () => {
	test('previewing an attached .md renders formatted markdown, not raw source', async ({
		page
	}) => {
		await page.goto('/app/ai-chat');
		await waitForAuthenticated(page);
		await page.waitForURL(/\/app\/ai-chat\?thread=/, { timeout: 15000 });
		await expect(page.locator('textarea')).toBeVisible({ timeout: 10000 });

		// Attach a markdown file through the hidden file input. Uploading also
		// exercises the server MIME allowlist: the chip only becomes clickable
		// once the upload succeeds.
		await page
			.locator('input[type="file"]')
			.first()
			.setInputFiles({
				name: 'e2e-notes.md',
				mimeType: 'text/markdown',
				buffer: Buffer.from(MARKDOWN, 'utf8')
			});

		const chip = page.getByTestId('attachment-chip').first();
		await expect(chip).toBeVisible({ timeout: 15000 });
		// role="button" is only set once the attachment is clickable (upload done).
		await expect(chip).toHaveAttribute('role', 'button', { timeout: 20000 });
		await chip.click();

		const content = page.getByTestId('attachment-preview-content');
		await expect(content).toBeVisible({ timeout: 15000 });

		// Heading is rendered as an <h1>, not shown as literal "# Preview Heading".
		await expect(content.locator('h1', { hasText: 'Preview Heading' })).toBeVisible();
		await expect(content).not.toContainText('# Preview Heading');

		// The hardened renderer blocks images entirely (no <img> is loaded).
		await expect(content.locator('img')).toHaveCount(0);
	});
});
