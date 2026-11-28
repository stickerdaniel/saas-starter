import { expect, type Page } from '@playwright/test';
import { test } from './utils/test';

// Cheaper layers rejected because: the shift comes from the browser removing the
// styled viewport scrollbar when a Bits UI dialog locks scrolling, which widens
// the box fixed elements are laid out in. JSDOM has no scrollbar and no layout.

const PAGE = '/en/privacy';

// Headless Chromium hides the viewport scrollbar unless this switch is dropped.
test.use({ launchOptions: { ignoreDefaultArgs: ['--hide-scrollbars'] } });

function scrollbarWidth(page: Page) {
	return page.evaluate(() => window.innerWidth - document.documentElement.clientWidth);
}

test('opening and closing the search dialog leaves the fixed header in place', async ({ page }) => {
	await page.setViewportSize({ width: 1440, height: 800 });
	await page.goto(PAGE);
	await expect(page.locator('#svelte-announcer')).toBeAttached({ timeout: 30_000 });
	expect(await scrollbarWidth(page)).toBeGreaterThan(0);

	const header = page.getByRole('navigation').first();
	const trigger = page.getByRole('button', { name: 'Search pages...' });
	const before = { header: await header.boundingBox(), trigger: await trigger.boundingBox() };

	await trigger.click();
	await expect(page.getByRole('dialog')).toBeVisible();
	await expect.poll(() => scrollbarWidth(page)).toBe(0);
	expect({ header: await header.boundingBox(), trigger: await trigger.boundingBox() }).toEqual(
		before
	);

	await page.keyboard.press('Escape');
	await expect(page.getByRole('dialog')).toBeHidden();
	await expect.poll(() => scrollbarWidth(page)).toBeGreaterThan(0);
	expect({ header: await header.boundingBox(), trigger: await trigger.boundingBox() }).toEqual(
		before
	);
});
