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
		// exercises the server MIME allowlist: the attachment only offers a
		// preview once the upload succeeds.
		await page
			.locator('input[type="file"]')
			.first()
			.setInputFiles({
				name: 'e2e-notes.md',
				mimeType: 'text/markdown',
				buffer: Buffer.from(MARKDOWN, 'utf8')
			});

		await page.getByRole('button', { name: 'Preview e2e-notes.md' }).click({ timeout: 20000 });

		const content = page.getByTestId('attachment-preview-content');
		await expect(content).toBeVisible({ timeout: 15000 });

		// Heading is rendered as an <h1>, not shown as literal "# Preview Heading".
		await expect(content.locator('h1', { hasText: 'Preview Heading' })).toBeVisible();
		await expect(content).not.toContainText('# Preview Heading');

		// The hardened renderer blocks images entirely (no <img> is loaded).
		await expect(content.locator('img')).toHaveCount(0);
	});

	// Cheaper layers rejected because truncation and tooltip hover/focus behavior
	// require browser layout; a request-only check cannot render the dialog DOM.
	test('preview titles reveal only visually truncated filenames', async ({ page }) => {
		await page.goto('/app/ai-chat');
		await waitForAuthenticated(page);
		await page.waitForURL(/\/app\/ai-chat\?thread=/, { timeout: 15000 });
		await expect(page.locator('textarea')).toBeVisible({ timeout: 10000 });

		const fileInput = page.locator('input[type="file"]').first();
		const longName = `quarterly-strategy-${'very-long-'.repeat(18)}notes.md`;
		await fileInput.setInputFiles({
			name: longName,
			mimeType: 'text/markdown',
			buffer: Buffer.from('# Long title\nPreview title geometry.', 'utf8')
		});

		const longPreview = page.getByRole('button', { name: `Preview ${longName}` });
		await expect(longPreview).toBeAttached({ timeout: 20000 });

		const shortName = 'brief.md';
		await fileInput.setInputFiles({
			name: shortName,
			mimeType: 'text/markdown',
			buffer: Buffer.from('# Brief\nNo hidden title text.', 'utf8')
		});
		const shortLabel = `Preview ${shortName}`;
		await expect(page.getByRole('button', { name: shortLabel })).toBeAttached({ timeout: 20000 });
		await longPreview.click();

		const dialog = page.getByRole('dialog');
		await expect(dialog).toBeVisible();
		await expect(dialog).toHaveAccessibleName(longName);
		const close = dialog.locator('[data-slot="dialog-close"]');
		const tooltip = page.locator('[data-slot="tooltip-content"]');
		await expect(close).toBeFocused();
		await expect(tooltip).toHaveCount(0);

		const title = dialog.locator('[data-slot="attachment-preview-title"]');
		await expect(title).toHaveText(longName);
		await expect(title).toHaveCSS('white-space', 'nowrap');
		await expect(title).toHaveCSS('text-overflow', 'ellipsis');
		await expect(title).toHaveCSS('overflow', 'hidden');
		const titleGeometry = await title.evaluate((element) => {
			const style = getComputedStyle(element);
			const rect = element.getBoundingClientRect();
			return {
				clientWidth: element.clientWidth,
				scrollWidth: element.scrollWidth,
				visibleTextRight: rect.right - Number.parseFloat(style.paddingRight)
			};
		});
		expect(titleGeometry.scrollWidth).toBeGreaterThan(titleGeometry.clientWidth);
		const closeBox = await close.boundingBox();
		expect(closeBox).not.toBeNull();
		expect(titleGeometry.visibleTextRight).toBeLessThanOrEqual(closeBox!.x);

		await title.hover();
		await expect(tooltip).toHaveText(longName);
		await page.mouse.move(0, 0);
		await close.focus();
		await expect(tooltip).toHaveCount(0);
		await page.keyboard.press('Tab');
		await expect(title).toBeFocused();
		await expect(tooltip).toHaveText(longName);

		// Each attachment owns its dialog, so the next preview opens once this one is gone.
		await close.click();
		await expect(dialog).toHaveCount(0);
		await page.getByRole('button', { name: shortLabel }).click();
		await expect(dialog).toBeVisible();
		await expect(dialog).toHaveAccessibleName(shortName);

		const shortTitle = dialog.locator('[data-slot="attachment-preview-title"]');
		await expect(shortTitle).toHaveText(shortName);
		await expect(close).toBeFocused();
		await expect(shortTitle).not.toHaveAttribute('tabindex');
		await expect(tooltip).toHaveCount(0);
		const shortTitleGeometry = await shortTitle.evaluate((element) => ({
			clientWidth: element.clientWidth,
			scrollWidth: element.scrollWidth
		}));
		expect(shortTitleGeometry.scrollWidth).toBeLessThanOrEqual(shortTitleGeometry.clientWidth);
		await shortTitle.hover();
		await expect(tooltip).toHaveCount(0);
		await shortTitle.focus();
		await expect(tooltip).toHaveCount(0);
	});
});
