import { test, expect, type Page } from '@playwright/test';
import dotenv from 'dotenv';
import { ConvexHttpClient } from 'convex/browser';
import { api } from '../src/lib/convex/_generated/api';
import {
	expectTableQueryParamMissing,
	expectTableQueryParams,
	getTableQueryParam
} from './utils/convex-table-url-assertions';

dotenv.config({ path: '.env.test' });

const SITE_URL = process.env.PUBLIC_SITE_URL || 'http://localhost:5173';
const TEST_PASSWORD = 'TestPassword123!';
const VERCEL_BYPASS_SECRET = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;

type SeedRole = 'admin' | 'user';
type SeedVerification = 'verified' | 'unverified';

type SeedUser = {
	email: string;
	name: string;
	role: SeedRole;
	verification: SeedVerification;
};

function getRequestHeaders(): Record<string, string> {
	const headers: Record<string, string> = {
		'Content-Type': 'application/json',
		Origin: SITE_URL
	};
	if (VERCEL_BYPASS_SECRET) {
		headers['x-vercel-protection-bypass'] = VERCEL_BYPASS_SECRET;
	}
	return headers;
}

async function createAuthUser(user: SeedUser) {
	const response = await fetch(`${SITE_URL}/api/auth/sign-up/email`, {
		method: 'POST',
		headers: getRequestHeaders(),
		body: JSON.stringify({
			email: user.email,
			password: TEST_PASSWORD,
			name: user.name
		})
	});

	if (!response.ok) {
		const errorBody = await response.text().catch(() => 'unknown error');
		throw new Error(`Failed to create seed user ${user.email}: ${response.status} ${errorBody}`);
	}
}

async function waitForUsersTableReady(page: Page) {
	await expect(page.getByTestId('admin-users-page')).toBeVisible();
	await expect(page.getByTestId('admin-users-table')).toBeVisible();
	await expect.poll(async () => page.getByTestId('admin-users-loading').count()).toBe(0);
	await expect(page.getByTestId('admin-users-email-cell').first()).toBeVisible({ timeout: 10000 });
}

async function applySeedSearch(page: Page, seedPrefix: string) {
	await page.getByTestId('admin-users-search').fill(seedPrefix);
	await page.waitForTimeout(400);
	await expect.poll(async () => page.getByTestId('admin-users-loading').count()).toBe(0);
	await expect
		.poll(
			async () => {
				const emails = (await page.getByTestId('admin-users-email-cell').allTextContents())
					.map((value) => value.trim())
					.filter(Boolean);
				return emails.length > 0 && emails.every((email) => email.includes(seedPrefix));
			},
			{ timeout: 10000 }
		)
		.toBe(true);
}

function getRoleWeight(roleLabel: string) {
	return roleLabel.toLowerCase().includes('admin') ? 0 : 1;
}

function isRoleOrderSorted(roleLabels: string[], direction: 'asc' | 'desc') {
	for (let i = 1; i < roleLabels.length; i++) {
		const previous = getRoleWeight(roleLabels[i - 1]);
		const current = getRoleWeight(roleLabels[i]);
		if (direction === 'asc' && current < previous) return false;
		if (direction === 'desc' && current > previous) return false;
	}
	return true;
}

async function getCurrentPageNumber(page: Page) {
	const indicatorText =
		(await page.getByTestId('admin-users-page-indicator').textContent())?.trim() ?? '';
	const match = indicatorText.match(/Page\s+(\d+)/i);
	return match ? Number.parseInt(match[1], 10) : NaN;
}

async function getPageIndicator(page: Page) {
	const indicatorText =
		(await page.getByTestId('admin-users-page-indicator').textContent())?.trim() ?? '';
	const match = indicatorText.match(/Page\s+(\d+)\s+of\s+(\d+)/i);
	if (!match) {
		return { current: NaN, total: NaN };
	}
	return {
		current: Number.parseInt(match[1], 10),
		total: Number.parseInt(match[2], 10)
	};
}

function expectSortedEmails(emails: string[], direction: 'asc' | 'desc') {
	const normalized = emails.map((email) => email.toLowerCase());
	const sorted = [...normalized].sort((a, b) => a.localeCompare(b));
	if (direction === 'desc') sorted.reverse();
	expect(normalized).toEqual(sorted);
}

test.describe('Admin Users Table', () => {
	test.describe.configure({ mode: 'serial', timeout: 180000 });

	const testSecret = process.env.AUTH_E2E_TEST_SECRET;
	const convexUrl = process.env.PUBLIC_CONVEX_URL || process.env.VITE_CONVEX_URL;

	let client: ConvexHttpClient;
	let seedPrefix = '';
	let searchTargetEmail = '';
	let negativeCheckEmail = '';
	const createdSeedEmails: string[] = [];
	let uncaughtPageErrors: string[] = [];

	test.beforeAll(async () => {
		test.setTimeout(180000);

		if (!testSecret) {
			throw new Error('AUTH_E2E_TEST_SECRET is required in .env.test');
		}
		if (!convexUrl) {
			throw new Error('PUBLIC_CONVEX_URL or VITE_CONVEX_URL is required in .env.test');
		}

		client = new ConvexHttpClient(convexUrl);
		seedPrefix = `table-${Date.now()}`;

		const seedUsers: SeedUser[] = Array.from({ length: 12 }, (_, index) => {
			const localPart =
				index === 7
					? `${seedPrefix}-search-target`
					: `${seedPrefix}-user-${String(index).padStart(2, '0')}`;
			return {
				email: `${localPart}@e2e.example.com`,
				name: `Table Seed User ${String(index).padStart(2, '0')}`,
				role: index < 4 ? 'admin' : 'user',
				verification: index < 8 ? 'verified' : 'unverified'
			};
		});

		searchTargetEmail = seedUsers[7].email;
		negativeCheckEmail = seedUsers[10].email;

		for (const user of seedUsers) {
			await createAuthUser(user);
			createdSeedEmails.push(user.email);

			if (user.role === 'admin') {
				await client.mutation(api.tests.createTestAdminUser, {
					email: user.email,
					secret: testSecret
				});
				continue;
			}

			if (user.verification === 'verified') {
				await client.mutation(api.tests.verifyTestUserEmail, {
					email: user.email,
					secret: testSecret
				});
			}
		}
	});

	test.afterAll(async () => {
		if (!testSecret || !client) return;

		for (const email of createdSeedEmails) {
			try {
				await client.mutation(api.tests.deleteTestUser, {
					email,
					secret: testSecret
				});
			} catch (error) {
				console.warn(`[admin-users-table] cleanup failed for ${email}:`, error);
			}
		}
	});

	test.beforeEach(async ({ page }) => {
		uncaughtPageErrors = [];
		page.on('pageerror', (error) => {
			uncaughtPageErrors.push(error.message);
		});

		await page.goto('/en/admin/users');
		await page.waitForLoadState('networkidle');
		await waitForUsersTableReady(page);
	});

	test.afterEach(() => {
		expect(
			uncaughtPageErrors,
			`Uncaught browser runtime errors:\n${uncaughtPageErrors.join('\n')}`
		).toEqual([]);
	});

	test('renders table controls', async ({ page }) => {
		await expect(page.getByTestId('admin-users-search')).toBeVisible();
		await expect(page.getByTestId('admin-users-pagination-prev')).toBeVisible();
		await expect(page.getByTestId('admin-users-pagination-next')).toBeVisible();
		await expect(page.getByTestId('admin-users-pagination-last')).toBeVisible();
	});

	test('search filters users', async ({ page }) => {
		await page.getByTestId('admin-users-search').fill(searchTargetEmail);
		await expect.poll(async () => page.getByTestId('admin-users-loading').count()).toBe(0);

		await expect(
			page.getByTestId('admin-users-email-cell').filter({ hasText: searchTargetEmail })
		).toHaveCount(1);
		await expect(
			page.getByTestId('admin-users-email-cell').filter({ hasText: negativeCheckEmail })
		).toHaveCount(0);
	});

	test('role filter shows only admins', async ({ page }) => {
		await applySeedSearch(page, seedPrefix);

		await page.getByTestId('admin-users-role-filter-trigger').click();
		await page.getByTestId('admin-users-role-filter-admin').click();
		await expect.poll(async () => page.getByTestId('admin-users-loading').count()).toBe(0);
		await expect(page.getByTestId('admin-users-filter-clear')).toBeVisible();

		const roleLabels = (await page.getByTestId('admin-users-role-badge').allTextContents()).map(
			(value) => value.trim()
		);
		expect(roleLabels.length).toBeGreaterThan(0);
		expect(roleLabels.every((role) => role.toLowerCase() === 'admin')).toBe(true);

		await page.getByTestId('admin-users-filter-clear').click();
		await expect(page.getByTestId('admin-users-filter-clear')).toHaveCount(0);
	});

	test('status filter shows only unverified users', async ({ page }) => {
		await applySeedSearch(page, seedPrefix);

		await page.getByTestId('admin-users-status-filter-trigger').click();
		await page.getByTestId('admin-users-status-filter-unverified').click();
		await expect.poll(async () => page.getByTestId('admin-users-loading').count()).toBe(0);

		const statusLabels = (await page.getByTestId('admin-users-status-badge').allTextContents()).map(
			(value) => value.trim()
		);
		expect(statusLabels.length).toBeGreaterThan(0);
		expect(statusLabels.every((status) => status.toLowerCase() === 'unverified')).toBe(true);
	});

	test('pagination next and previous navigates pages', async ({ page }) => {
		await applySeedSearch(page, seedPrefix);
		await expect
			.poll(async () => page.getByTestId('admin-users-pagination-next').isEnabled())
			.toBe(true);

		const firstPageFirstEmail = (
			await page.getByTestId('admin-users-email-cell').first().textContent()
		)?.trim();
		expect(firstPageFirstEmail).toBeTruthy();
		const initialPageNumber = await getCurrentPageNumber(page);
		expect(initialPageNumber).toBe(1);

		await page.getByTestId('admin-users-pagination-next').click();
		await expect.poll(() => getCurrentPageNumber(page)).toBe(initialPageNumber + 1);
		await expect.poll(async () => page.getByTestId('admin-users-loading').count()).toBe(0);

		const secondPageFirstEmail = (
			await page.getByTestId('admin-users-email-cell').first().textContent()
		)?.trim();
		expect(secondPageFirstEmail).toBeTruthy();
		expect(secondPageFirstEmail).not.toBe(firstPageFirstEmail);

		await page.getByTestId('admin-users-pagination-prev').click();
		await expect.poll(() => getCurrentPageNumber(page)).toBe(initialPageNumber);
		await expect.poll(async () => page.getByTestId('admin-users-loading').count()).toBe(0);
		await expect(page.getByTestId('admin-users-email-cell').first()).toHaveText(
			firstPageFirstEmail!
		);
	});

	test('reopening page+cursor URL restores the same users page', async ({ page }) => {
		await expect
			.poll(async () => page.getByTestId('admin-users-pagination-next').isEnabled())
			.toBe(true);

		await page.getByTestId('admin-users-pagination-next').click();
		await expect.poll(async () => page.getByTestId('admin-users-loading').count()).toBe(0);

		const pageUrl = page.url();
		const firstBefore = (
			await page.getByTestId('admin-users-email-cell').first().textContent()
		)?.trim();
		const indicatorBefore = await getPageIndicator(page);
		expect(firstBefore).toBeTruthy();
		expect(indicatorBefore.current).toBe(2);

		await page.goto(pageUrl);
		await page.waitForLoadState('networkidle');
		await waitForUsersTableReady(page);

		const firstAfter = (
			await page.getByTestId('admin-users-email-cell').first().textContent()
		)?.trim();
		const indicatorAfter = await getPageIndicator(page);
		expect(indicatorAfter.current).toBe(2);
		expect(firstAfter).toBe(firstBefore);
	});

	test('after refresh on deep page, previous page navigation still works', async ({ page }) => {
		await page.goto(`/en/admin/users?search=${encodeURIComponent(seedPrefix)}&page_size=1`);
		await page.waitForLoadState('networkidle');
		await waitForUsersTableReady(page);

		await expect
			.poll(async () => page.getByTestId('admin-users-pagination-next').isEnabled())
			.toBe(true);
		await page.getByTestId('admin-users-pagination-next').click();
		await expect.poll(() => getCurrentPageNumber(page)).toBe(2);
		await page.getByTestId('admin-users-pagination-next').click();
		await expect.poll(() => getCurrentPageNumber(page)).toBe(3);

		const deepPageUrl = page.url();
		await page.goto(deepPageUrl);
		await page.waitForLoadState('networkidle');
		await waitForUsersTableReady(page);
		await expect.poll(() => getCurrentPageNumber(page)).toBe(3);

		await expect(page.getByTestId('admin-users-pagination-prev')).toBeEnabled();
		await page.getByTestId('admin-users-pagination-prev').click();
		await expect.poll(() => getCurrentPageNumber(page)).toBe(2);
	});

	test('jump to last page walks cursors and lands on final page', async ({ page }) => {
		await page.goto(`/en/admin/users?search=${encodeURIComponent(seedPrefix)}&page_size=1`);
		await page.waitForLoadState('networkidle');
		await waitForUsersTableReady(page);

		await expect
			.poll(async () => page.getByTestId('admin-users-pagination-next').isEnabled())
			.toBe(true);

		await page.getByTestId('admin-users-pagination-last').click();
		await expect
			.poll(
				async () => {
					const indicator = await getPageIndicator(page);
					return indicator.current === indicator.total ? indicator.total : -1;
				},
				{ timeout: 30000 }
			)
			.toBeGreaterThan(1);

		const indicator = await getPageIndicator(page);
		await expectTableQueryParams(page, {
			page: `${indicator.total}`,
			cursor: /.+/
		});
		await expect(page.getByTestId('admin-users-pagination-next')).toBeDisabled();
	});

	test('role sorting toggles asc and desc', async ({ page }) => {
		await applySeedSearch(page, seedPrefix);

		const roleSortButton = page.getByTestId('admin-users-sort-role');

		await roleSortButton.click();
		await expect.poll(async () => page.getByTestId('admin-users-loading').count()).toBe(0);
		const ascRoleLabels = (await page.getByTestId('admin-users-role-badge').allTextContents()).map(
			(value) => value.trim()
		);
		expect(ascRoleLabels.length).toBeGreaterThan(0);
		expect(isRoleOrderSorted(ascRoleLabels, 'asc')).toBe(true);

		await roleSortButton.click();
		await expect.poll(async () => page.getByTestId('admin-users-loading').count()).toBe(0);
		const descRoleLabels = (await page.getByTestId('admin-users-role-badge').allTextContents()).map(
			(value) => value.trim()
		);
		expect(descRoleLabels.length).toBeGreaterThan(0);
		expect(isRoleOrderSorted(descRoleLabels, 'desc')).toBe(true);
	});

	test('syncs table state to URL params', async ({ page }) => {
		await applySeedSearch(page, seedPrefix);
		await expectTableQueryParams(page, { search: seedPrefix });

		await page.getByTestId('admin-users-role-filter-trigger').click();
		await page.getByTestId('admin-users-role-filter-admin').click();
		await expectTableQueryParams(page, { role: 'admin' });
		await expect.poll(() => getCurrentPageNumber(page)).toBe(1);

		await page.getByTestId('admin-users-status-filter-trigger').click();
		await page.getByTestId('admin-users-status-filter-unverified').click();
		await expectTableQueryParams(page, { status: 'unverified' });
		await expect.poll(() => getCurrentPageNumber(page)).toBe(1);

		await page.getByTestId('admin-users-sort-role').click();
		await expect.poll(() => getTableQueryParam(page, 'sort') ?? '').toMatch(/^role\.(asc|desc)$/);

		await page.getByTestId('admin-users-filter-clear').click();
		await expect.poll(async () => page.getByTestId('admin-users-loading').count()).toBe(0);
		await expectTableQueryParams(page, { search: seedPrefix });

		await expect
			.poll(async () => page.getByTestId('admin-users-pagination-next').isEnabled())
			.toBe(true);
		await page.getByTestId('admin-users-pagination-next').click();
		await expectTableQueryParams(page, { page: '2', cursor: /.+/ });
	});

	test('hydrates table state from URL params', async ({ page }) => {
		const params = new URLSearchParams({
			search: seedPrefix,
			role: 'user',
			status: 'unverified',
			sort: 'email.asc',
			page_size: '20',
			page: '1'
		});
		await page.goto(`/en/admin/users?${params.toString()}`);
		await page.waitForLoadState('networkidle');
		await waitForUsersTableReady(page);

		await expect(page.getByTestId('admin-users-search')).toHaveValue(seedPrefix);
		await expect(page.getByTestId('admin-users-role-filter-trigger')).toContainText('user');
		await expect(page.getByTestId('admin-users-status-filter-trigger')).toContainText('Unverified');

		const roleLabels = (await page.getByTestId('admin-users-role-badge').allTextContents()).map(
			(value) => value.trim()
		);
		expect(roleLabels.length).toBeGreaterThan(0);
		expect(roleLabels.every((role) => role.toLowerCase() === 'user')).toBe(true);

		const statusLabels = (await page.getByTestId('admin-users-status-badge').allTextContents()).map(
			(value) => value.trim()
		);
		expect(statusLabels.length).toBeGreaterThan(0);
		expect(statusLabels.every((status) => status.toLowerCase() === 'unverified')).toBe(true);

		const visibleEmails = (await page.getByTestId('admin-users-email-cell').allTextContents())
			.map((value) => value.trim())
			.filter(Boolean);
		expect(visibleEmails.length).toBeGreaterThan(1);
		expectSortedEmails(visibleEmails, 'asc');

		await expectTableQueryParams(page, {
			search: seedPrefix,
			role: 'user',
			status: 'unverified',
			sort: 'email.asc',
			page_size: '20'
		});
		await expectTableQueryParamMissing(page, 'cursor');
	});
});
