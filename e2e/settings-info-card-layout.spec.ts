import { test, expect } from '@playwright/test';
import en from '../src/i18n/en.json' with { type: 'json' };

/**
 * Information cards are not interactive, so copy they clip has no way to be
 * revealed. On a narrow screen the whole description has to stay readable
 * inside the card, and the card has to fit the page.
 *
 * Cheaper layers rejected because: clipping comes from the compiled
 * application CSS inside the real authenticated page and its scroll
 * composition, which jsdom cannot lay out and a request-only check cannot see.
 * No deployed backend is intrinsically needed. This is a deliberate exception
 * that reuses the existing signed-in chromium project rather than adding a
 * component harness or a demo route.
 */
test.describe('Settings information card on a narrow screen', () => {
	test.use({ viewport: { width: 320, height: 640 } });

	test('keeps the whole description readable within the card', async ({ page }) => {
		await page.goto('/en/app/settings?tab=security');
		await page.locator('html[data-hydrated]').waitFor({ timeout: 60000 });

		const description = page.getByText(en.settings.security.passkey_info_description, {
			exact: true
		});
		await expect(page.getByText(en.settings.security.passkey_info_title)).toBeVisible();
		await expect(description).toBeVisible();
		await description.scrollIntoViewIfNeeded();

		const layout = await description.evaluate((element) => {
			type Box = { left: number; right: number; top: number; bottom: number };
			const range = document.createRange();
			range.selectNodeContents(element);
			const text = range.getBoundingClientRect();
			const contains = (outer: Box, inner: Box) =>
				inner.left >= outer.left - 1 &&
				inner.right <= outer.right + 1 &&
				inner.top >= outer.top - 1 &&
				inner.bottom <= outer.bottom + 1;
			const overlaps = (a: Box, b: Box) =>
				a.left < b.right - 1 &&
				b.left < a.right - 1 &&
				a.top < b.bottom - 1 &&
				b.top < a.bottom - 1;

			// No box may cut the laid-out text off sideways. Vertically, text a visitor
			// can scroll to is reachable: a vertical scroll container does not clip, and
			// the boxes outside it clip only the scroller, not the text within it.
			const clipping: string[] = [];
			let insideVerticalScroller = false;
			for (let box: Element | null = element; box; box = box.parentElement) {
				const style = getComputedStyle(box);
				const bounds = box.getBoundingClientRect();
				const cutX =
					style.overflowX !== 'visible' &&
					(text.left < bounds.left - 1 || text.right > bounds.right + 1);
				const clipsY =
					!insideVerticalScroller && (style.overflowY === 'hidden' || style.overflowY === 'clip');
				const hidesLines = box === element && clipsY && box.scrollHeight > box.clientHeight + 1;
				const cutY =
					hidesLines || (clipsY && (text.top < bounds.top - 1 || text.bottom > bounds.bottom + 1));
				if (cutX) clipping.push(`${box.tagName.toLowerCase()} x`);
				if (cutY) clipping.push(`${box.tagName.toLowerCase()} y`);
				if (style.overflowY === 'auto' || style.overflowY === 'scroll') {
					insideVerticalScroller = true;
				}
			}

			const cardElement = element.closest('[data-slot="item"]')!;
			const card = cardElement.getBoundingClientRect();
			const title = cardElement.querySelector('[data-slot="item-title"]')!.getBoundingClientRect();
			const icon = cardElement.querySelector('[data-slot="item-media"]')!.getBoundingClientRect();
			return {
				clipping,
				textInCard: contains(card, text),
				coversTitleOrIcon: overlaps(text, title) || overlaps(text, icon),
				cardInViewport: card.left >= 0 && card.right <= document.documentElement.clientWidth,
				pageScrollsSideways:
					document.documentElement.scrollWidth > document.documentElement.clientWidth
			};
		});

		expect(layout).toEqual({
			clipping: [],
			textInCard: true,
			coversTitleOrIcon: false,
			cardInViewport: true,
			pageScrollsSideways: false
		});
	});
});
