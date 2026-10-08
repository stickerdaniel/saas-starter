import { expect, test } from '@playwright/test';

// Cheaper layers rejected because: the launcher opens support by navigating
// with `goto`. A request never opens the widget. Focus is not asserted here:
// loading the widget replaces the placeholder button.
test('opening support from the launcher updates the page URL', async ({ page }) => {
	await page.goto('/en');
	// `goto` resolves on the document load event, which can arrive before the
	// page component's click handler exists. The announcer is mounted from the
	// root afterNavigate, after that handler is attached.
	await expect(page.locator('#svelte-announcer')).toBeAttached({ timeout: 30_000 });
	await page.getByRole('button', { name: 'Open feedback' }).click();

	await expect(page).toHaveURL(/[?&]support=open(?:&|$)/);
});
