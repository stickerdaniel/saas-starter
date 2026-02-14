import { expect, test, type Page } from '@playwright/test';
import {
	expectTableQueryParamMissing,
	expectTableQueryParams,
	getTableQueryParam
} from './utils/convex-table-url-assertions';

async function waitForSettingsTableReady(page: Page) {
	await expect(page.getByTestId('admin-settings-page')).toBeVisible();
	await expect(page.getByTestId('recipients-table')).toBeVisible();
	await expect.poll(async () => page.getByTestId('recipients-loading').count()).toBe(0);
}

async function addCustomEmailRecipient(page: Page, email: string) {
	await page.getByTestId('add-email-button').click();
	await page.getByTestId('add-email-input').fill(email);
	await page.getByTestId('add-email-submit').click();
	await expect(page.getByTestId(`recipient-row-${email}`)).toBeVisible({ timeout: 10000 });
}

test.describe('Admin Settings Table', () => {
	let uncaughtPageErrors: string[] = [];

	test.beforeEach(async ({ page }) => {
		uncaughtPageErrors = [];
		page.on('pageerror', (error) => {
			uncaughtPageErrors.push(error.message);
		});
		await page.goto('/en/admin/settings');
		await page.waitForLoadState('networkidle');
		await waitForSettingsTableReady(page);
	});

	test.afterEach(() => {
		expect(
			uncaughtPageErrors,
			`Uncaught browser runtime errors:\n${uncaughtPageErrors.join('\n')}`
		).toEqual([]);
	});

	test('renders settings table controls', async ({ page }) => {
		await expect(page.getByTestId('admin-settings-search')).toBeVisible();
		await expect(page.getByTestId('admin-settings-type-filter-trigger')).toBeVisible();
		await expect(page.getByTestId('admin-settings-pagination-prev')).toBeVisible();
		await expect(page.getByTestId('admin-settings-pagination-next')).toBeVisible();
		await expect(page.getByTestId('admin-settings-pagination-last')).toBeVisible();
	});

	test('syncs search/filter/sort to URL', async ({ page }) => {
		await page.getByTestId('admin-settings-search').fill('admin');
		await page.waitForTimeout(400);
		await expectTableQueryParams(page, { search: 'admin' });

		await page.getByTestId('admin-settings-type-filter-trigger').click();
		await page.getByTestId('admin-settings-type-filter-admin').click();
		await expectTableQueryParams(page, { type: 'admin' });
		await expectTableQueryParamMissing(page, 'page');

		await page.getByTestId('admin-settings-sort-email').click();
		await expect.poll(() => getTableQueryParam(page, 'sort') ?? '').toMatch(/^email\.(asc|desc)$/);
	});

	test('hydrates URL params into UI state after reload', async ({ page }) => {
		const params = new URLSearchParams({
			search: 'admin',
			type: 'admin',
			sort: 'email.asc',
			page_size: '1',
			page: '1'
		});
		await page.goto(`/en/admin/settings?${params.toString()}`);
		await page.waitForLoadState('networkidle');
		await waitForSettingsTableReady(page);

		await expect(page.getByTestId('admin-settings-search')).toHaveValue('admin');
		await expect(page.getByTestId('admin-settings-type-filter-trigger')).toContainText('Admin');
		await expectTableQueryParams(page, {
			search: 'admin',
			type: 'admin',
			sort: 'email.asc',
			page_size: '1',
			page: '1'
		});
		await expectTableQueryParamMissing(page, 'cursor');
	});

	test('paginates with cursor params and restores previous page', async ({ page }) => {
		const customEmail = `settings-table-${Date.now()}@example.com`;
		await addCustomEmailRecipient(page, customEmail);

		await page.goto('/en/admin/settings?page_size=1');
		await page.waitForLoadState('networkidle');
		await waitForSettingsTableReady(page);

		await expect
			.poll(async () => page.getByTestId('admin-settings-pagination-next').isEnabled())
			.toBe(true);

		await page.getByTestId('admin-settings-pagination-next').click();
		await expectTableQueryParams(page, { page: '2', cursor: /.+/ });
		await expect.poll(async () => page.getByTestId('recipients-loading').count()).toBe(0);

		await page.getByTestId('admin-settings-pagination-prev').click();
		await expectTableQueryParamMissing(page, 'page');
		await expectTableQueryParamMissing(page, 'cursor');
	});
});
