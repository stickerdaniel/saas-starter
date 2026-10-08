import { expect, test } from '@playwright/test';

// Cheaper layers rejected because: the launcher updates the page URL through
// `goto`, and only a real browser can report which element keeps focus while it
// does. A request never opens the widget.
test('opening support from the launcher keeps the launcher focused', async ({ page }) => {
	await page.goto('/en');
	// `goto` resolves on the document load event, which can arrive before the
	// page component's click handler exists. The announcer is mounted from the
	// root onMount, after that handler is attached.
	await expect(page.locator('#svelte-announcer')).toBeAttached({ timeout: 30_000 });
	const launcher = page.getByRole('button', { name: 'Open feedback' });
	await launcher.click();

	await expect(page).toHaveURL(/[?&]support=open(?:&|$)/);
	// Opening replaces the placeholder button with the close control.
	await expect(page.getByRole('button', { name: 'Close feedback' })).toBeFocused();
});
