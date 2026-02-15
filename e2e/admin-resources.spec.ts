import { expect, test, type Page } from '@playwright/test';

async function waitForResourceTable(page: Page, prefix: string) {
	await expect(page.getByTestId(`${prefix}-page`)).toBeVisible();
	await expect(page.getByTestId(`${prefix}-table`)).toBeVisible();
	await expect.poll(async () => page.getByTestId(`${prefix}-loading`).count()).toBe(0);
}

test.describe('Admin Resource Framework', () => {
	let uncaughtPageErrors: string[] = [];

	test.beforeEach(async ({ page }) => {
		uncaughtPageErrors = [];
		page.on('pageerror', (error) => {
			uncaughtPageErrors.push(error.message);
		});
	});

	test.afterEach(() => {
		expect(
			uncaughtPageErrors,
			`Uncaught browser runtime errors:\n${uncaughtPageErrors.join('\n')}`
		).toEqual([]);
	});

	test('keeps existing admin links first and appends resources below', async ({ page }) => {
		await page.goto('/en/admin/demo-projects');
		await page.waitForLoadState('networkidle');
		await waitForResourceTable(page, 'admin-demo-projects');

		const navTestIds = await page
			.locator('[data-testid^="sidebar-nav-admin-"]')
			.evaluateAll((elements) =>
				elements.map((element) => element.getAttribute('data-testid') || '')
			);

		const dashboardIndex = navTestIds.indexOf('sidebar-nav-admin-dashboard');
		const usersIndex = navTestIds.indexOf('sidebar-nav-admin-users');
		const supportIndex = navTestIds.indexOf('sidebar-nav-admin-support');
		const settingsIndex = navTestIds.indexOf('sidebar-nav-admin-settings');
		const firstResourceIndex = navTestIds.indexOf('sidebar-nav-admin-demo-projects');

		expect(dashboardIndex).toBeGreaterThanOrEqual(0);
		expect(usersIndex).toBeGreaterThan(dashboardIndex);
		expect(supportIndex).toBeGreaterThan(usersIndex);
		expect(settingsIndex).toBeGreaterThan(supportIndex);
		expect(firstResourceIndex).toBeGreaterThan(settingsIndex);
	});

	test('creates edits and deletes a demo tag resource', async ({ page }) => {
		const tagName = `playwright-tag-${Date.now()}`;
		const updatedColor = '#10b981';

		await page.goto('/en/admin/demo-tags');
		await page.waitForLoadState('networkidle');
		await waitForResourceTable(page, 'admin-demo-tags');

		await page.getByTestId('admin-demo-tags-create').click();
		await expect(page.getByTestId('admin-demo-tags-create-page')).toBeVisible();

		await page.getByTestId('admin-demo-tags-name-input').fill(tagName);
		await page.getByTestId('admin-demo-tags-color-input').fill('#2563eb');
		await page.getByTestId('admin-demo-tags-create-submit').click();

		await waitForResourceTable(page, 'admin-demo-tags');
		await page.getByTestId('admin-demo-tags-search').fill(tagName);
		await page.waitForTimeout(400);
		await expect.poll(async () => page.getByTestId('admin-demo-tags-loading').count()).toBe(0);
		await expect(page.getByTestId('demo-tags-name-cell').first()).toContainText(tagName);

		await page.locator('[data-testid^="admin-demo-tags-row-view-"]').first().click();
		await expect(page.getByTestId('admin-demo-tags-detail-page')).toBeVisible();

		await page.getByTestId('admin-demo-tags-detail-edit').click();
		await expect(page.getByTestId('admin-demo-tags-edit-page')).toBeVisible();
		await page.getByTestId('admin-demo-tags-color-input').fill(updatedColor);
		await page.getByTestId('admin-demo-tags-edit-submit').click();
		await expect(page.getByTestId('admin-demo-tags-detail-page')).toBeVisible();
		await expect(page.getByText(updatedColor).first()).toBeVisible();

		await page.getByTestId('admin-demo-tags-detail-delete').click();
		await waitForResourceTable(page, 'admin-demo-tags');
	});
});
