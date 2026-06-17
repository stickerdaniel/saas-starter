import { expect, test } from '@playwright/test';

test.describe('cross-origin isolation headers', () => {
	test('SSR marketing response carries COOP + CORP', async ({ request }) => {
		const response = await request.get('/en');
		expect(response.status()).toBe(200);
		const h = response.headers();
		expect(h['cross-origin-opener-policy']).toBe('same-origin-allow-popups');
		expect(h['cross-origin-resource-policy']).toBe('same-origin');
		expect(h['cross-origin-opener-policy']).not.toBe('same-origin');
	});

	test('signin page carries COOP + CORP and the OAuth flow is intact', async ({ page }) => {
		const response = await page.goto('/signin');
		expect(response).not.toBeNull();
		const h = response!.headers();
		expect(h['cross-origin-opener-policy']).toBe('same-origin-allow-popups');
		expect(h['cross-origin-resource-policy']).toBe('same-origin');
		await expect(page.locator('[data-testid="email-input"]')).toBeVisible({ timeout: 30000 });
		await expect(page.locator('[data-testid="email-input"]')).toBeEnabled({ timeout: 30000 });
		const hasGoogleOAuth =
			(await page.locator('[data-testid="signin-oauth-google-button"]').count()) > 0;
		test.skip(!hasGoogleOAuth, 'Google OAuth is disabled in this environment');
		await expect(page.locator('[data-testid="signin-oauth-google-button"]')).toBeEnabled();
	});
});
