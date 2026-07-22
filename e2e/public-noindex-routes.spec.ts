import { expect, test } from '@playwright/test';

test.describe('private route noindex and robots.txt', () => {
	test('signin SSR HTML is noindex with no canonical or hreflang', async ({ request }) => {
		const response = await request.get('/signin');

		expect(response.status()).toBe(200);
		const html = await response.text();

		// Crawler-visible noindex directive must be in the SSR markup.
		expect(html).toContain('name="robots"');
		expect(html).toContain('noindex');

		// Private routes must not advertise canonical/hreflang to crawlers.
		expect(html).not.toContain('rel="canonical"');
		expect(html).not.toContain('hreflang="x-default"');
	});

	test('robots.txt allows app/admin and only disallows /api/', async ({ request }) => {
		const response = await request.get('/robots.txt');

		expect(response.status()).toBe(200);
		const body = await response.text();

		expect(body).toContain('Disallow: /api/');
		expect(body).not.toContain('Disallow: /en/app');
		expect(body).not.toContain('Disallow: /en/admin');
	});

	test('marketing page keeps canonical and is not noindex', async ({ request }) => {
		const response = await request.get('/en/privacy');

		expect(response.status()).toBe(200);
		const html = await response.text();

		expect(html).toContain('rel="canonical"');
		expect(html).not.toContain('name="robots"');

		// Exactly one canonical: guards against the removed duplicate global SEOHead.
		const canonicalCount = (html.match(/rel="canonical"/g) ?? []).length;
		expect(canonicalCount).toBe(1);
	});
});
