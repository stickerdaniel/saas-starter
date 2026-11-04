import { expect, test } from '@playwright/test';

// /pricing is non-prerendered, so a bare (prefixless) request hits the runtime
// handleLanguage hook that issues the 307. maxRedirects: 0 keeps the raw redirect
// so we can assert its status and Location instead of following it.
test.describe('bare-path language redirect', () => {
	test('a valid lang_pref cookie wins the redirect', async ({ request }) => {
		const response = await request.get('/pricing', {
			maxRedirects: 0,
			headers: { Cookie: 'lang_pref=de' }
		});

		expect(response.status()).toBe(307);
		expect(response.headers()['location']).toMatch(/\/de\/pricing$/);
	});

	test('falls back to Accept-Language when no cookie is set', async ({ request }) => {
		const response = await request.get('/pricing', {
			maxRedirects: 0,
			headers: { 'Accept-Language': 'fr-FR,fr;q=0.9' }
		});

		expect(response.status()).toBe(307);
		expect(response.headers()['location']).toMatch(/\/fr\/pricing$/);
	});

	test('the cookie beats a conflicting Accept-Language header', async ({ request }) => {
		const response = await request.get('/pricing', {
			maxRedirects: 0,
			headers: { Cookie: 'lang_pref=de', 'Accept-Language': 'fr' }
		});

		expect(response.status()).toBe(307);
		expect(response.headers()['location']).toMatch(/\/de\/pricing$/);
	});

	test('a tampered cookie is ignored and Accept-Language is used', async ({ request }) => {
		const response = await request.get('/pricing', {
			maxRedirects: 0,
			headers: { Cookie: 'lang_pref=zz', 'Accept-Language': 'es' }
		});

		expect(response.status()).toBe(307);
		expect(response.headers()['location']).toMatch(/\/es\/pricing$/);
		expect(response.headers()['location']).not.toMatch(/\/zz\//);
	});
});

// The served <html lang> needs both the %lang% placeholder in app.html and the
// handleHtmlLang hook that fills it. Either one going missing fails silently:
// without the placeholder the replace is a no-op and every locale ships the
// hard-coded fallback, without the hook the raw token reaches the browser. So
// this asserts the rendered response rather than unit-testing the hook. The
// Home and pricing take separate route branches, so both remain covered after
// negotiated marketing pages moved to SSR.
test.describe('SSR html lang', () => {
	for (const lang of ['en', 'de', 'es', 'fr'] as const) {
		test(`serves lang="${lang}" on localized marketing routes`, async ({ request }) => {
			for (const path of [`/${lang}`, `/${lang}/pricing`]) {
				const response = await request.get(path);
				expect(response.ok(), `${path} should be reachable`).toBe(true);

				const html = await response.text();
				expect(html, `${path} should declare lang="${lang}"`).toContain(`<html lang="${lang}"`);
				expect(html, `${path} should not leak the placeholder`).not.toContain('%lang%');
			}
		});
	}
});

// Old Impressum links from search results and bookmarks must land on the legal notice
// that replaced the page, whichever representation the client asks for.
// Cheaper layers rejected because: the load test calls the redirect alone, while only the
// deployed hook chain shows that the Markdown negotiation lets the request reach it.
test('the former Impressum URL redirects to the Contact legal notice', async ({ request }) => {
	for (const accept of ['text/html', 'text/markdown']) {
		const response = await request.get('/en/impressum', {
			maxRedirects: 0,
			headers: { Accept: accept }
		});

		expect(response.status(), accept).toBe(308);
		expect(response.headers()['location'], accept).toMatch(/\/en\/contact#legal-notice$/);
	}
});

// Fork copy can keep an old in-app link to /impressum. The client router resolves it
// without a document request, so only a hydrated page shows whether it still redirects.
test('an in-app link to the former Impressum opens the legal notice', async ({ page }) => {
	await page.goto('/en/about');
	await expect(page.locator('#svelte-announcer')).toBeAttached({ timeout: 30_000 });
	await page.evaluate(() => {
		const link = document.createElement('a');
		link.href = '/en/impressum';
		link.textContent = 'Old Impressum link';
		document.querySelector('main')?.append(link);
	});

	await page.getByRole('link', { name: 'Old Impressum link' }).click();

	await expect(page).toHaveURL(/\/en\/contact#legal-notice$/);
	await expect(page.getByRole('heading', { name: 'Legal notice' })).toBeVisible();
});
