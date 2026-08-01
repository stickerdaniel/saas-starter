import { test, expect, type Route } from '@playwright/test';
import { waitForAuthenticated } from './utils/auth';

// Uses pre-authenticated session state from setup.
//
// Signing out revokes the shared session on the server, so this project runs
// last and the suite can afford exactly one logout. The upload guard has to be
// exercised on that one: it exempts sign-out deliberately, and getting that
// wrong strands the user on a page whose session is already gone.
test('signout works, and is not stopped by an upload in flight', async ({ page }) => {
	await page.goto('/app/ai-chat');
	await waitForAuthenticated(page);
	await page.waitForURL(/\/app\/ai-chat\?thread=/, { timeout: 15000 });
	await expect(page.locator('textarea')).toBeVisible({ timeout: 10000 });

	// Hold the storage POST open so a transfer is running across the whole logout.
	await page.route(/\/api\/storage\/upload/, (_route: Route) => {});
	await page
		.locator('input[type="file"]')
		.first()
		.setInputFiles({
			name: 'in-flight.txt',
			mimeType: 'text/plain',
			buffer: Buffer.from('Signout regression notes.\n', 'utf8')
		});
	await expect(page.getByTestId('attachment-chip').first().getByRole('progressbar')).toBeVisible({
		timeout: 15000
	});

	// A draft, so there is something of this person's in storage to leave behind.
	const secret = 'Half a sentence nobody else should read';
	await page.locator('textarea').fill(secret);
	/** Everything the chat surfaces are keeping in this browser. */
	const chatState = () =>
		page.evaluate(() =>
			Object.keys(localStorage)
				.filter((key) => key.startsWith('drafts:') || key.startsWith('attachments:'))
				.map((key) => localStorage.getItem(key) ?? '')
		);
	await expect.poll(async () => (await chatState()).join('')).toContain(secret);

	// Click user menu and sign out
	await page.locator('#user-menu-trigger').click();
	await page.locator('[data-testid="logout-button"]').click();

	// Should redirect away from app after logout (to home or signin page)
	// With i18n, this could be /en, /en/signin, etc.
	await page.waitForURL(/.*\/[a-z]{2}(\/signin)?(\?.*)?$/, { timeout: 15000 });

	// Nothing this person wrote greets whoever signs in next on this browser.
	// Emptied rather than removed, so a store still alive cannot put it back.
	const remaining = await chatState();
	expect(remaining.length).toBeGreaterThan(0);
	expect(remaining.every((value) => value === '{}')).toBe(true);
});
