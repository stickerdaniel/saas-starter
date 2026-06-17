import { expect, test } from '@playwright/test';

test.describe('public PWA manifest', () => {
	test('manifest is served as valid JSON with the expected fields', async ({ request }) => {
		const response = await request.get('/manifest.webmanifest');
		expect(response.ok()).toBe(true);

		const manifest = JSON.parse(await response.text());
		expect(manifest.name).toBe('SaaS Starter');
		expect(manifest.display).toBe('standalone');

		const maskable = (manifest.icons ?? []).filter((i: { purpose?: string }) =>
			(i.purpose ?? '').includes('maskable')
		);
		expect(maskable.length).toBeGreaterThanOrEqual(1);
	});

	test('icon assets are served as PNGs', async ({ request }) => {
		const icons = [
			'/apple-touch-icon.png',
			'/icon-192.png',
			'/icon-512.png',
			'/icon-512-maskable.png'
		];
		for (const icon of icons) {
			const response = await request.get(icon);
			expect(response.ok(), icon).toBe(true);
			expect(response.headers()['content-type'], icon).toMatch(/^image\/png/);
		}
	});

	test('the home page links the manifest and apple-touch-icon', async ({ page }) => {
		await page.goto('/');
		await expect(page.locator('link[rel=manifest]')).toHaveCount(1);
		await expect(page.locator('link[rel=apple-touch-icon]')).toHaveCount(1);
	});
});
