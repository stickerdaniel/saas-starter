import { test, expect } from '@playwright/test';

/**
 * The authenticated layout scrolls its pages inside a Bits UI scroll area, whose
 * viewport stays `overflow: hidden` until the custom scrollbar mounts on the
 * client. Without JavaScript, and on a slow device until hydration, a visitor
 * must still be able to scroll the page content.
 *
 * Cheaper layers rejected because: whether the server-rendered viewport scrolls
 * depends on the compiled application CSS outranking the primitive's inline
 * style in a real layout, which jsdom cannot lay out and a request-only check
 * cannot scroll. No deployed backend is intrinsically needed; the spec reuses
 * the signed-in chromium project rather than adding a demo route.
 */
test.describe('Authenticated page without JavaScript', () => {
	// A short window makes the settings page taller than the content viewport.
	test.use({ javaScriptEnabled: false, viewport: { width: 1280, height: 360 } });

	test('scrolls the page content with the mouse wheel', async ({ page }) => {
		await page.goto('/en/app/settings');

		const content = page.locator('main [data-slot="scroll-area-viewport"]');
		await expect(content).toBeVisible();
		const overflow = await content.evaluate(
			(element) => element.scrollHeight - element.clientHeight
		);
		expect(overflow, 'the page must be taller than its viewport for this check').toBeGreaterThan(0);

		// Wheel near the bottom edge: the settings tab strip at the top is a
		// horizontal scroller of its own and would take the gesture.
		const box = (await content.boundingBox())!;
		await page.mouse.move(box.x + box.width / 2, box.y + box.height - 24);
		await page.mouse.wheel(0, 400);

		await expect
			.poll(() => content.evaluate((element) => element.scrollTop), {
				message: 'the content viewport must scroll natively before hydration'
			})
			.toBeGreaterThan(0);
	});
});
