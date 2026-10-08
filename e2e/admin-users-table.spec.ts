import { ownTestEmail } from './utils/owned-test-data';
import { test, expect, type Page } from '@playwright/test';
import 'varlock/auto-load';
import { ConvexHttpClient } from 'convex/browser';
import { api } from '../src/lib/convex/_generated/api';
import {
	expectTableQueryParamMissing,
	expectTableQueryParams,
	getTableQueryParam
} from './utils/convex-table-url-assertions';
import { resolveConvexUrl } from './utils/convex-url';
import { resolveSiteUrl } from './utils/site-url';
import { getPreviewBypass } from './utils/preview-bypass';

const SITE_URL = resolveSiteUrl();
const TEST_PASSWORD = 'TestPassword123!';
const bypass = getPreviewBypass();

type SeedRole = 'admin' | 'user';
type SeedVerification = 'verified' | 'unverified';

type SeedUser = {
	email: string;
	name: string;
	role: SeedRole;
	verification: SeedVerification;
};

function getRequestHeaders(): Record<string, string> {
	return {
		'Content-Type': 'application/json',
		Origin: SITE_URL,
		...bypass.headers
	};
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

const SEED_USER_COUNT = 12;

// A test that opens its own URL first skips the beforeEach visit, which would
// only add a page load that can fail before the behaviour under test starts.
const OPENS_OWN_URL = { annotation: { type: 'opens-own-url' } };

async function applySeedSearch(page: Page, seedPrefix: string) {
	await page.getByTestId('admin-users-search').fill(seedPrefix);
	// The search is debounced, and the unfiltered first page already lists the
	// newest seed users. Only the filtered total shows the search has applied;
	// paging before then lands on page 1 again once it does.
	await expect(page.getByTestId('admin-users-selection-text')).toHaveText(
		new RegExp(` of ${SEED_USER_COUNT} users selected$`)
	);
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
	const convexUrl = resolveConvexUrl();

	let client: ConvexHttpClient;
	let seedPrefix = '';
	let seedUsers: SeedUser[] = [];
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
			throw new Error(
				'Convex URL not configured (set PUBLIC_CONVEX_URL or start local dev server)'
			);
		}

		client = new ConvexHttpClient(convexUrl);
		seedPrefix = `table-${Date.now()}`;

		seedUsers = Array.from({ length: SEED_USER_COUNT }, (_, index) => {
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
			ownTestEmail(user.email, 'userEmails');
			createdSeedEmails.push(user.email);
			await createAuthUser(user);

			if (user.role === 'admin') {
				ownTestEmail(user.email);
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

	test.beforeEach(async ({ page }, testInfo) => {
		uncaughtPageErrors = [];
		page.on('pageerror', (error) => {
			uncaughtPageErrors.push(error.message);
		});

		if (testInfo.annotations.some(({ type }) => type === OPENS_OWN_URL.annotation.type)) return;
		await page.goto('/en/admin/users');
		await page.waitForLoadState('domcontentloaded');
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
		const search = page.getByTestId('admin-users-search');
		await search.fill(searchTargetEmail);
		await expect.poll(async () => page.getByTestId('admin-users-loading').count()).toBe(0);
		// The search field stays mounted across the URL update, so focus does too.
		await expect(search).toBeFocused();

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
		// URL synchronization settles after the click. Reopening the previous URL
		// would test page one even though the table has already advanced.
		await expectTableQueryParams(page, { page: '2', cursor: /.+/ });

		const pageUrl = page.url();
		const firstBefore = (
			await page.getByTestId('admin-users-email-cell').first().textContent()
		)?.trim();
		const indicatorBefore = await getPageIndicator(page);
		expect(firstBefore).toBeTruthy();
		expect(indicatorBefore.current).toBe(2);

		await page.goto(pageUrl);
		await page.waitForLoadState('domcontentloaded');
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
		await page.waitForLoadState('domcontentloaded');
		await waitForUsersTableReady(page);

		await expect
			.poll(async () => page.getByTestId('admin-users-pagination-next').isEnabled())
			.toBe(true);
		await page.getByTestId('admin-users-pagination-next').click();
		await expect.poll(() => getCurrentPageNumber(page)).toBe(2);
		await page.getByTestId('admin-users-pagination-next').click();
		await expect.poll(() => getCurrentPageNumber(page)).toBe(3);

		await expectTableQueryParams(page, { page: '3', cursor: /.+/ });
		const deepPageUrl = page.url();
		await page.goto(deepPageUrl);
		await page.waitForLoadState('domcontentloaded');
		await waitForUsersTableReady(page);
		await expect.poll(() => getCurrentPageNumber(page)).toBe(3);

		await expect(page.getByTestId('admin-users-pagination-prev')).toBeEnabled();
		await page.getByTestId('admin-users-pagination-prev').click();
		await expect.poll(() => getCurrentPageNumber(page)).toBe(2);
	});

	test('jump to last page lands on the final filtered page', async ({ page }) => {
		await page.goto(`/en/admin/users?search=${encodeURIComponent(seedPrefix)}&page_size=1`);
		await page.waitForLoadState('domcontentloaded');
		await waitForUsersTableReady(page);

		// One user per page, so the indicator shows the filtered total once the
		// count for this search has answered. Only then is the final page known.
		const indicator = page.getByTestId('admin-users-page-indicator');
		await expect(indicator).toHaveText(`Page 1 of ${SEED_USER_COUNT}`);

		await page.getByTestId('admin-users-pagination-last').click();
		await expect(indicator).toHaveText(`Page ${SEED_USER_COUNT} of ${SEED_USER_COUNT}`);
		// Newest first by default, so the final page holds the first seed user.
		await expect(page.getByTestId('admin-users-email-cell')).toHaveText([seedUsers[0].email]);
		await expectTableQueryParams(page, {
			page: `${SEED_USER_COUNT}`,
			cursor: /.+/
		});
		await expect(page.getByTestId('admin-users-pagination-next')).toBeDisabled();
	});

	test('table paging keeps the scroll position and records browser history', async ({ page }) => {
		// Cheaper layers rejected because: only a real browser can report the scroll
		// position and walk the session history the table's URL state writes.
		await page.setViewportSize({ width: 1280, height: 480 });
		await page.goto(`/en/admin/users?search=${encodeURIComponent(seedPrefix)}&page_size=1`);
		await page.waitForLoadState('domcontentloaded');
		await waitForUsersTableReady(page);
		const indicator = page.getByTestId('admin-users-page-indicator');
		await expect(indicator).toHaveText(`Page 1 of ${SEED_USER_COUNT}`);

		// This page moves the layout scroll viewport. This does not claim window scroll.
		const scroller = page.locator('#main-content [data-slot="scroll-area-viewport"]');
		const scrolled = await scroller.evaluate((node) => {
			// The users page is often shorter than the shell, so this viewport has
			// nothing to scroll until it is height-constrained. Same element either way.
			node.style.setProperty('max-height', '180px');
			node.style.setProperty('overflow', 'auto');
			node.scrollTop = node.scrollHeight;
			return node.scrollTop;
		});
		expect(scrolled).toBeGreaterThan(0);
		await page.getByTestId('admin-users-pagination-next').click();
		await expect(indicator).toHaveText(`Page 2 of ${SEED_USER_COUNT}`);
		await expect(page).toHaveURL(/[?&]page=2(?:&|$)/);
		expect(await scroller.evaluate((node) => node.scrollTop)).toBeGreaterThan(0);

		await page.getByTestId('admin-users-pagination-next').click();
		await expect(indicator).toHaveText(`Page 3 of ${SEED_USER_COUNT}`);
		// The indicator follows the local cache. Back walks the URL, so wait for it.
		await expect(page).toHaveURL(/[?&]page=3(?:&|$)/);

		await page.goBack();
		await expect(indicator).toHaveText(`Page 2 of ${SEED_USER_COUNT}`);
		await page.goForward();
		await expect(indicator).toHaveText(`Page 3 of ${SEED_USER_COUNT}`);
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

	test('hydrates table state from URL params', OPENS_OWN_URL, async ({ page }) => {
		const params = new URLSearchParams({
			search: seedPrefix,
			role: 'user',
			status: 'unverified',
			sort: 'email.asc',
			page_size: '20',
			page: '1'
		});
		await page.goto(`/en/admin/users?${params.toString()}`);
		await page.waitForLoadState('domcontentloaded');
		await expect(page.getByTestId('admin-users-table')).toBeVisible();
		// Exactly the seed users this query selects, in its order: no other query
		// on this page can render this list.
		const expectedEmails = seedUsers
			.filter((user) => user.role === 'user' && user.verification === 'unverified')
			.map((user) => user.email)
			.sort((a, b) => a.localeCompare(b));
		await expect(page.getByTestId('admin-users-email-cell')).toHaveText(expectedEmails);

		await expect(page.getByTestId('admin-users-search')).toHaveValue(seedPrefix);
		await expect(page.getByTestId('admin-users-role-filter-trigger')).toContainText(/user/i);
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

	test('row actions change role, ban, unban, and revoke sessions', async ({ page }) => {
		// Dedicated throwaway so write actions never mutate the shared seed users.
		// Distinct prefix keeps it out of the seedPrefix searches above; afterAll
		// cleans it up via createdSeedEmails.
		const writeTargetEmail = `write-target-${Date.now()}@e2e.example.com`;
		await createAuthUser({
			email: writeTargetEmail,
			name: 'Write Target User',
			role: 'user',
			verification: 'verified'
		});
		createdSeedEmails.push(writeTargetEmail);
		await client.mutation(api.tests.verifyTestUserEmail, {
			email: writeTargetEmail,
			secret: testSecret!
		});

		await page.getByTestId('admin-users-search').fill(writeTargetEmail);
		await expect(
			page.getByTestId('admin-users-email-cell').filter({ hasText: writeTargetEmail })
		).toHaveCount(1, { timeout: 10000 });
		await expect(page.getByTestId('admin-users-row-actions')).toHaveCount(1);

		// Role change: user -> admin
		await page.getByTestId('admin-users-row-actions').click();
		await page.getByTestId('admin-users-action-set-role').click();
		await page.getByTestId('admin-users-action-role-admin').click();
		await page.getByTestId('confirm-dialog-confirm').click();
		// Dialog only closes after the mutation succeeds
		await expect(page.getByTestId('confirm-dialog-confirm')).toHaveCount(0, {
			timeout: 10000
		});
		await expect
			.poll(
				async () =>
					(await page.getByTestId('admin-users-role-badge').textContent())?.trim().toLowerCase(),
				{ timeout: 10000 }
			)
			.toBe('admin');

		// Ban with a reason
		await page.getByTestId('admin-users-row-actions').click();
		await page.getByTestId('admin-users-action-ban').click();
		await page.getByTestId('confirm-dialog-field').fill('E2E write-path ban');
		await page.getByTestId('confirm-dialog-confirm').click();
		await expect(page.getByTestId('confirm-dialog-confirm')).toHaveCount(0, {
			timeout: 10000
		});
		await expect
			.poll(
				async () =>
					(await page.getByTestId('admin-users-status-badge').textContent())?.trim().toLowerCase(),
				{ timeout: 10000 }
			)
			.toBe('banned');

		// Unban restores the verified status
		await page.getByTestId('admin-users-row-actions').click();
		await page.getByTestId('admin-users-action-unban').click();
		await page.getByTestId('confirm-dialog-confirm').click();
		await expect(page.getByTestId('confirm-dialog-confirm')).toHaveCount(0, {
			timeout: 10000
		});
		await expect
			.poll(
				async () =>
					(await page.getByTestId('admin-users-status-badge').textContent())?.trim().toLowerCase(),
				{ timeout: 10000 }
			)
			.toBe('verified');

		// Revoke sessions: dialog closes and the success toast appears
		await page.getByTestId('admin-users-row-actions').click();
		await page.getByTestId('admin-users-action-revoke-sessions').click();
		await page.getByTestId('confirm-dialog-confirm').click();
		const revokeToast = page.locator('[data-sonner-toast]').filter({
			hasText: /sessions have been revoked/i
		});
		await expect(revokeToast).toBeVisible({ timeout: 10000 });
		await expect(page.getByTestId('confirm-dialog-confirm')).toHaveCount(0, {
			timeout: 10000
		});
	});
});
