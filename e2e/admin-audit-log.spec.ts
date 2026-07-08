import { test, expect, type Page } from '@playwright/test';
import 'varlock/auto-load';
import { ConvexHttpClient } from 'convex/browser';
import { api } from '../src/lib/convex/_generated/api';
import { resolveConvexUrl } from './utils/convex-url';
import { resolveSiteUrl } from './utils/site-url';
import { getPreviewBypass } from './utils/preview-bypass';

const SITE_URL = resolveSiteUrl();
const TEST_PASSWORD = 'TestPassword123!';
const bypass = getPreviewBypass();

function getRequestHeaders(): Record<string, string> {
	return {
		'Content-Type': 'application/json',
		Origin: SITE_URL,
		...bypass.headers
	};
}

async function createAuthUser(email: string, name: string) {
	const response = await fetch(`${SITE_URL}/api/auth/sign-up/email`, {
		method: 'POST',
		headers: getRequestHeaders(),
		body: JSON.stringify({ email, password: TEST_PASSWORD, name })
	});

	if (!response.ok) {
		const errorBody = await response.text().catch(() => 'unknown error');
		throw new Error(`Failed to create seed user ${email}: ${response.status} ${errorBody}`);
	}
}

async function waitForAuditLogReady(page: Page) {
	await expect(page.getByTestId('admin-audit-log-page')).toBeVisible();
	await expect(page.getByTestId('admin-audit-log-table')).toBeVisible();
	await expect.poll(async () => page.getByTestId('admin-audit-log-loading').count()).toBe(0);
}

async function selectActionFilter(page: Page, action: string) {
	await page.getByTestId('admin-audit-log-action-filter').click();
	await page.getByTestId(`admin-audit-log-action-filter-${action}`).click();
	await expect.poll(async () => page.getByTestId('admin-audit-log-loading').count()).toBe(0);
}

// Drive a real ban + unban through the admin users UI so the backend writes
// genuine ban_user / unban_user audit entries (the mutations require the admin
// session, so they cannot be triggered from an unauthenticated HTTP client).
async function banAndUnbanTarget(page: Page, email: string) {
	await page.goto('/en/admin/users');
	await page.waitForLoadState('domcontentloaded');
	await expect(page.getByTestId('admin-users-page')).toBeVisible();
	await expect(page.getByTestId('admin-users-search')).toBeVisible({ timeout: 30000 });

	await page.getByTestId('admin-users-search').fill(email);
	await expect(page.getByTestId('admin-users-email-cell').filter({ hasText: email })).toHaveCount(
		1,
		{ timeout: 10000 }
	);
	await expect(page.getByTestId('admin-users-row-actions')).toHaveCount(1);

	// Ban with a reason
	await page.getByTestId('admin-users-row-actions').click();
	await page.getByTestId('admin-users-action-ban').click();
	await page.getByTestId('admin-users-ban-reason-input').fill('Audit log e2e ban');
	await page.getByTestId('admin-users-dialog-confirm').click();
	await expect(page.getByTestId('admin-users-dialog-confirm')).toHaveCount(0, { timeout: 10000 });
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
	await page.getByTestId('admin-users-dialog-confirm').click();
	await expect(page.getByTestId('admin-users-dialog-confirm')).toHaveCount(0, { timeout: 10000 });
	await expect
		.poll(
			async () =>
				(await page.getByTestId('admin-users-status-badge').textContent())?.trim().toLowerCase(),
			{ timeout: 10000 }
		)
		.toBe('verified');
}

test.describe('Admin Audit Log', () => {
	test.describe.configure({ mode: 'serial', timeout: 180000 });

	const testSecret = process.env.AUTH_E2E_TEST_SECRET;
	const convexUrl = resolveConvexUrl();

	let client: ConvexHttpClient;
	let targetEmail = '';
	const createdEmails: string[] = [];
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
		targetEmail = `audit-target-${Date.now()}@e2e.example.com`;

		await createAuthUser(targetEmail, 'Audit Log Target');
		createdEmails.push(targetEmail);
		await client.mutation(api.tests.verifyTestUserEmail, {
			email: targetEmail,
			secret: testSecret
		});
	});

	test.afterAll(async () => {
		if (!testSecret || !client) return;

		for (const email of createdEmails) {
			try {
				await client.mutation(api.tests.deleteTestUser, { email, secret: testSecret });
			} catch (error) {
				console.warn(`[admin-audit-log] cleanup failed for ${email}:`, error);
			}
		}
	});

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

	test('records admin actions and filters the log by action', async ({ page }) => {
		await banAndUnbanTarget(page, targetEmail);

		await page.goto('/en/admin/audit-log');
		await page.waitForLoadState('domcontentloaded');
		await waitForAuditLogReady(page);

		// The ban + unban above produced at least two rows, newest first.
		await expect(page.getByTestId('audit-log-row').first()).toBeVisible({ timeout: 10000 });

		// Filter to ban_user: every visible badge is a ban, the URL carries the
		// canonical `action` param, and the target cell resolves to our user.
		await selectActionFilter(page, 'ban_user');
		await expect.poll(() => new URL(page.url()).searchParams.get('action')).toBe('ban_user');
		const banBadges = (await page.getByTestId('audit-log-action-badge').allTextContents()).map(
			(value) => value.trim()
		);
		expect(banBadges.length).toBeGreaterThan(0);
		expect(banBadges.every((label) => label === 'Ban user')).toBe(true);
		await expect(
			page.getByTestId('audit-log-target-cell').filter({ hasText: targetEmail })
		).toHaveCount(1, { timeout: 10000 });

		// Narrow to unban_user: the badge set changes and our target reappears
		// under the unban entry, proving the filter re-queries the log.
		await selectActionFilter(page, 'unban_user');
		await expect.poll(() => new URL(page.url()).searchParams.get('action')).toBe('unban_user');
		const unbanBadges = (await page.getByTestId('audit-log-action-badge').allTextContents()).map(
			(value) => value.trim()
		);
		expect(unbanBadges.length).toBeGreaterThan(0);
		expect(unbanBadges.every((label) => label === 'Unban user')).toBe(true);
		await expect(
			page.getByTestId('audit-log-target-cell').filter({ hasText: targetEmail })
		).toHaveCount(1, { timeout: 10000 });

		// Clearing the filter drops the param and widens the log again.
		await page.getByTestId('admin-audit-log-filter-clear').click();
		await expect.poll(async () => page.getByTestId('admin-audit-log-loading').count()).toBe(0);
		await expect(page.getByTestId('admin-audit-log-filter-clear')).toHaveCount(0);
		await expect.poll(() => new URL(page.url()).searchParams.get('action')).toBeNull();
		await expect(page.getByTestId('audit-log-row').first()).toBeVisible({ timeout: 10000 });
	});
});
