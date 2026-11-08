import { expect, test } from '@playwright/test';
import { waitForAuthenticated } from './utils/auth';

// Chromium ignores ::-webkit-scrollbar on an element that sets scrollbar-width
// or scrollbar-color, and Tailwind's scrollbar-thin sets one. The scroller then
// falls back to a native overlay scrollbar with no gutter, and the bottom fade,
// which insets by --scrollbar-w, no longer matches what is painted.
test('the chat log reserves the styled scrollbar width its fade insets by', async ({ page }) => {
	await page.goto('/app/community-chat');
	await waitForAuthenticated(page);
	const log = page.getByRole('log');
	await expect(log).toBeVisible();

	const styledWidth = await page.evaluate(() =>
		parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--scrollbar-w'))
	);
	expect(styledWidth).toBeGreaterThan(0);
	await expect
		.poll(() => log.evaluate((element: HTMLElement) => element.offsetWidth - element.clientWidth))
		.toBe(styledWidth);
});
