import { expect, test } from '@playwright/test';

// Cheaper layers rejected because: the launcher updates the page URL through
// `goto`, and only a real browser can report which element keeps focus while it
// does. A request never opens the widget.
test('opening support from the launcher keeps the launcher focused', async ({ page }) => {
	await page.goto('/en');
	const launcher = page.getByRole('button', { name: 'Open feedback' });
	await launcher.click();

	await expect(page).toHaveURL(/[?&]support=open(?:&|$)/);
	await expect(launcher).toBeFocused();
});
