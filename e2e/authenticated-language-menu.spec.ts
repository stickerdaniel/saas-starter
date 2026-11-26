import { expect, type Page } from '@playwright/test';
import { test } from './utils/test';
import { waitForAuthenticated } from './utils/auth';
import { resolveSiteUrl } from './utils/site-url';

// Cheaper layers rejected because: the stored locale is written through the
// deployed Better Auth endpoint after the menu, loaded on first use, navigates.
// A request alone never runs the menu.

async function storedLocale(page: Page): Promise<string | undefined> {
	const response = await page.request.get('/api/auth/get-session?disableCookieCache=true');
	const session = (await response.json()) as { user?: { locale?: string } } | null;
	return session?.user?.locale;
}

test('the app header language menu switches and stores the locale', async ({ page, context }) => {
	await page.goto('/en/app');
	await waitForAuthenticated(page);
	const german = new URL(page.url()).pathname.replace(/^\/en\//, '/de/');

	try {
		await page.getByRole('button', { name: 'Change language' }).click();
		await page.getByRole('menuitemradio', { name: 'Deutsch' }).click();

		await expect.poll(() => new URL(page.url()).pathname).toBe(german);
		const cookies = await context.cookies();
		expect(cookies.find((cookie) => cookie.name === 'lang_pref')?.value).toBe('de');
		await expect.poll(() => storedLocale(page)).toBe('de');
	} finally {
		// The worker's user is shared by its other tests.
		await page.request.post('/api/auth/update-user', {
			headers: { Origin: resolveSiteUrl() },
			data: { locale: 'en' }
		});
	}
});
