import { expect, test } from '@playwright/test';

const isCloudflarePreview =
	(process.env.PLAYWRIGHT_BASE_URL ?? process.env.BASE_URL ?? '').includes('workers.dev') ||
	process.env.E2E_TARGET === 'cf';

// Cache-buster: CF Cache API ignores Vary: Accept, so HTML and markdown variants
// of the same URL share one cache key. A unique cb per request keeps each variant
// on a distinct key (markdown can't poison HTML) and forces a fresh origin fetch
// on the post-deploy run.
test.describe('public agent surface', () => {
	test('page navigation to the localized marketing home returns HTML', async ({ page }) => {
		const response = await page.goto(`/en?cb=${Date.now()}`);

		expect(response).not.toBeNull();
		expect(response?.status()).toBe(200);
		expect(response?.headers()['content-type']).toContain('text/html');
		await expect(page).toHaveURL(/\/en(\?|$)/);
	});

	test('generic GET requests to marketing pages do not return 406', async ({ request }) => {
		const response = await request.get(`/en?cb=${Date.now()}`);

		expect(response.status()).toBe(200);
		expect(response.headers()['content-type']).toContain('text/html');
		expect(new URL(response.url()).pathname).toBe('/en');
		expect(await response.text()).not.toContain('Not Acceptable');
	});

	test('marketing pages still return markdown when explicitly requested', async ({ request }) => {
		for (const path of ['/en', '/en/about', '/en/pricing']) {
			const response = await request.get(`${path}?cb=${Date.now()}`, {
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

	test('root discovery files are reachable without redirects', async ({ request }) => {
		const expectations = [
			{ path: '/llms.txt', contentType: 'text/plain; charset=utf-8' },
			{ path: '/robots.txt', contentType: 'text/plain; charset=utf-8' },
			{ path: '/sitemap.xml', contentType: 'application/xml; charset=utf-8' }
		];

		for (const { path, contentType } of expectations) {
			const response = await request.get(`${path}?cb=${Date.now()}`);

			expect(response.status(), path).toBe(200);
			expect(new URL(response.url()).pathname, path).toBe(path);
			expect(response.headers()['content-type'], path).toContain(contentType);
		}
	});

	test('prerendered marketing HTML revalidates, markdown variant stays private', async ({
		request
	}) => {
		test.skip(!isCloudflarePreview, 'worker patch is CF-only; not present in local test stack');
		const html = await request.get(`/en/about?cb=${Date.now()}`, {
			headers: { Accept: 'text/html' }
		});
		expect(html.status()).toBe(200);
		// public, no-cache: shells must never outlive their deploy's chunk set,
		// and staying non-edge-cacheable keeps a fixed zone Browser Cache TTL
		// from rewriting the browser-facing max-age back up, which let stale
		// shells 404 their chunk imports on client navigation after a deploy.
		expect(html.headers()['cache-control']).toContain('public');
		expect(html.headers()['cache-control']).toContain('no-cache');
		expect(html.headers()['cache-control']).not.toContain('s-maxage');

		const md = await request.get(`/en/about?cb=${Date.now()}`, {
			headers: { Accept: 'text/markdown' }
		});
		expect(md.status()).toBe(200);
		expect(md.headers()['content-type']).toContain('text/markdown');
		expect(md.headers()['cache-control']).toContain('private');
	});
});
