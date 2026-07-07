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

	test('email logo is embeddable cross-origin (no same-origin CORP)', async ({ request }) => {
		// Email clients render HTML in a browser context and load the logo cross-origin;
		// same-origin CORP would block it. The _headers "!" removal must drop it on CF
		// (which joins duplicate header values with a comma rather than overriding).
		const response = await request.get('/logo-email.png');
		expect(response.status()).toBe(200);
		const h = response.headers();
		expect(h['content-type']).toBe('image/png');
		expect(h['cross-origin-resource-policy']).not.toBe('same-origin');
	});
});
