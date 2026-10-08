import { expect, test } from '@playwright/test';

const isCloudflarePreview =
	(process.env.PLAYWRIGHT_BASE_URL ?? process.env.BASE_URL ?? '').includes('workers.dev') ||
	process.env.E2E_TARGET === 'cf';

// The HTML and markdown variants of a marketing page share one URL and differ only by
// Accept, so requests here deliberately reuse the same URL: a cache that kept either
// variant for the other would show up as the wrong representation.
test.describe('public agent surface', () => {
	test('page navigation to the localized marketing home returns HTML', async ({ page }) => {
		const response = await page.goto('/en');

		expect(response).not.toBeNull();
		expect(response?.status()).toBe(200);
		expect(response?.headers()['content-type']).toContain('text/html');
		await expect(page).toHaveURL(/\/en(\?|$)/);
	});

	test('generic GET requests to marketing pages do not return 406', async ({ request }) => {
		const response = await request.get('/en');

		expect(response.status()).toBe(200);
		expect(response.headers()['content-type']).toContain('text/html');
		expect(new URL(response.url()).pathname).toBe('/en');
		expect(await response.text()).not.toContain('Not Acceptable');
	});

	test('marketing pages negotiate HTML and markdown at the same URL in either order', async ({
		request
	}) => {
		const orders = [
			['text/html', 'text/markdown', 'text/html'],
			['text/markdown', 'text/html', 'text/markdown']
		];
		for (const path of ['/en', '/en/pricing']) {
			for (const order of orders) {
				for (const accept of order) {
					const label = `${path} ${order.join(' -> ')}: ${accept}`;
					const response = await request.get(path, { headers: { Accept: accept } });
					const body = await response.text();

					expect(response.status(), label).toBe(200);
					expect(response.headers()['vary'], label).toContain('Accept');
					if (accept === 'text/markdown') {
						expect(response.headers()['content-type'], label).toContain(
							'text/markdown; charset=utf-8'
						);
						expect(body, label).toContain('content_type: "marketing-page"');
					} else {
						expect(response.headers()['content-type'], label).toContain('text/html');
						expect(body, label).not.toContain('content_type: "marketing-page"');
					}
				}
			}
		}
	});

	test('root discovery files are reachable without redirects', async ({ request }) => {
		const expectations = [
			{ path: '/llms.txt', contentType: 'text/plain; charset=utf-8' },
			{ path: '/robots.txt', contentType: 'text/plain; charset=utf-8' },
			{ path: '/sitemap.xml', contentType: 'application/xml; charset=utf-8' }
		];

		for (const { path, contentType } of expectations) {
			const response = await request.get(path);

			expect(response.status(), path).toBe(200);
			expect(new URL(response.url()).pathname, path).toBe(path);
			expect(response.headers()['content-type'], path).toContain(contentType);
		}
	});

	test('marketing HTML revalidates, markdown variant stays private', async ({ request }) => {
		test.skip(!isCloudflarePreview, 'the cache policy is asserted against the deployed Worker');
		const html = await request.get('/en/privacy', {
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

		const md = await request.get('/en/privacy', {
			headers: { Accept: 'text/markdown' }
		});
		expect(md.status()).toBe(200);
		expect(md.headers()['content-type']).toContain('text/markdown');
		expect(md.headers()['cache-control']).toContain('private');
	});
});
