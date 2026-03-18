import { test, expect } from './utils/axe-test';

test.describe('Accessibility - Public Pages', () => {
	test('marketing home has no a11y violations', async ({ page, makeAxeBuilder }) => {
		await page.goto('/en');
		const results = await makeAxeBuilder().analyze();
		expect(results.violations).toEqual([]);
	});

	test('signin page has no a11y violations', async ({ page, makeAxeBuilder }) => {
		await page.goto('/en/signin');
		const results = await makeAxeBuilder().analyze();
		expect(results.violations).toEqual([]);
	});

	test('forgot password page has no a11y violations', async ({ page, makeAxeBuilder }) => {
		await page.goto('/en/forgot-password');
		const results = await makeAxeBuilder().analyze();
		expect(results.violations).toEqual([]);
	});
});
