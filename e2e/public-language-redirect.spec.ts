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
// marketing root is prerendered and /pricing is not, which covers both the
// build-time and the runtime substitution.
test.describe('SSR html lang', () => {
	for (const lang of ['en', 'de', 'es', 'fr'] as const) {
		test(`serves lang="${lang}" on prerendered and runtime routes`, async ({ request }) => {
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
