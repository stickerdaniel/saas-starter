import assert from 'node:assert/strict';
import { expect } from '@playwright/test';
import { runFixtureCheck } from './fixture-browser.ts';

// Streamdown's fullscreen overlay is a global rule keyed on `data-expanded`, an attribute
// other libraries set too: Sonner marks every toast with it while the stack is hovered.
await runFixtureCheck({
	label: 'Streamdown overlay check',
	fixture: 'src/lib/components/test-fixtures/StreamdownOverlayHarness.svelte',
	run: async (page, origin) => {
		await page.goto(origin);
		const viewport = page.viewportSize();
		assert(viewport, 'The fixture page must have a viewport');

		await page.getByRole('button', { name: 'Show toast' }).click();
		const toast = page.getByRole('listitem').filter({ hasText: 'Changes saved' });
		await toast.hover();
		await expect(toast).toHaveAttribute('data-expanded', 'true');
		const box = await toast.boundingBox();
		assert(
			box &&
				box.width < viewport.width / 2 &&
				box.height < viewport.height / 2 &&
				box.x > viewport.width / 2 &&
				box.y > viewport.height / 2,
			`An expanded toast must stay in the toaster's corner, not cover the window; scope Streamdown's fullscreen rule to the elements it expands: ${JSON.stringify(box)}`
		);
		await page.mouse.move(0, 0);

		await page.getByRole('button', { name: 'Expand table' }).click();
		const overlay = await page.getByRole('dialog', { name: 'Table' }).boundingBox();
		assert(
			overlay && overlay.width > viewport.width * 0.9 && overlay.height > viewport.height * 0.9,
			`Streamdown's own table fullscreen must still cover the window: ${JSON.stringify(overlay)}`
		);
		console.log('PASS: expanded toasts stay in place and Streamdown tables still go fullscreen');
	}
});
