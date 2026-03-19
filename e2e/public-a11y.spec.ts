import { test, expect } from './utils/axe-test';

const pages = [
	{ name: 'marketing home', path: '/en' },
	{ name: 'signin', path: '/en/signin' },
	{ name: 'forgot password', path: '/en/forgot-password' },
	{ name: 'about', path: '/en/about' },
	{ name: 'pricing', path: '/en/pricing' },
	{ name: 'terms', path: '/en/terms' },
	{ name: 'privacy', path: '/en/privacy' }
];

for (const theme of ['light', 'dark'] as const) {
	test.describe(`Accessibility - Public Pages (${theme})`, () => {
		test.use({
			colorScheme: theme
		});

		for (const { name, path } of pages) {
			test(`${name} has no a11y violations`, async ({ page, makeAxeBuilder }) => {
				// Set ModeWatcher to the correct theme before navigating
				await page.addInitScript((t) => {
					localStorage.setItem('mode-watcher-mode', t);
				}, theme);
				await page.goto(path);
				const results = await makeAxeBuilder().analyze();
				expect(results.violations).toEqual([]);
			});
		}
	});
}
