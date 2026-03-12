import { expect, test } from '@playwright/test';

test.describe('public agent surface', () => {
	test('page navigation to the localized marketing home returns HTML', async ({ page }) => {
		const response = await page.goto('/en');

		expect(response).not.toBeNull();
		expect(response?.status()).toBe(200);
		expect(response?.headers()['content-type']).toContain('text/html');
		await expect(page).toHaveURL(/\/en$/);
	});

	test('generic GET requests to marketing pages do not return 406', async ({
		request,
		baseURL
	}) => {
		const response = await request.get('/en');

		expect(response.status()).toBe(200);
		expect(response.headers()['content-type']).toContain('text/html');
		expect(response.url()).toBe(`${baseURL}/en`);
		expect(await response.text()).not.toContain('Not Acceptable');
	});

	test('marketing pages still return markdown when explicitly requested', async ({ request }) => {
		for (const path of ['/en', '/en/about', '/en/pricing']) {
			const response = await request.get(path, {
				headers: {
					Accept: 'text/markdown'
				}
			});

			expect(response.status(), path).toBe(200);
			expect(response.headers()['content-type'], path).toContain('text/markdown; charset=utf-8');
			expect(response.headers()['vary'], path).toContain('Accept');
			expect(await response.text(), path).toContain('content_type: "marketing-page"');
		}
	});

	test('root discovery files are reachable without redirects', async ({ request, baseURL }) => {
		const expectations = [
			{ path: '/llms.txt', contentType: 'text/plain; charset=utf-8' },
			{ path: '/robots.txt', contentType: 'text/plain; charset=utf-8' },
			{ path: '/sitemap.xml', contentType: 'application/xml; charset=utf-8' }
		];

		for (const { path, contentType } of expectations) {
			const response = await request.get(path);

			expect(response.status(), path).toBe(200);
			expect(response.url(), path).toBe(`${baseURL}${path}`);
			expect(response.headers()['content-type'], path).toContain(contentType);
		}
	});
});
