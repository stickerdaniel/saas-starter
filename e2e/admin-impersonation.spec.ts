import { test, expect, type Page } from '@playwright/test';
import 'varlock/auto-load';
import { ConvexHttpClient } from 'convex/browser';
import { api } from '../src/lib/convex/_generated/api';
import { resolveConvexUrl } from './utils/convex-url';
import { resolveSiteUrl } from './utils/site-url';
import { getPreviewBypass } from './utils/preview-bypass';
import { waitForAuthenticated } from './utils/auth';

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

test.describe('Admin Impersonation', () => {
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
		targetEmail = `impersonation-target-${Date.now()}@e2e.example.com`;

		await createAuthUser(targetEmail, 'Impersonation Target');
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
				console.warn(`[admin-impersonation] cleanup failed for ${email}:`, error);
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

	test('impersonates a user, redirects into the app, stops, and records the audit trail', async ({
		page
	}) => {
		// Find the target user in the admin table and start impersonation.
		await page.goto('/en/admin/users');
		await page.waitForLoadState('domcontentloaded');
		await expect(page.getByTestId('admin-users-page')).toBeVisible();
		await expect(page.getByTestId('admin-users-search')).toBeVisible({ timeout: 30000 });

		await page.getByTestId('admin-users-search').fill(targetEmail);
		await expect(
			page.getByTestId('admin-users-email-cell').filter({ hasText: targetEmail })
		).toHaveCount(1, { timeout: 10000 });
		await expect(page.getByTestId('admin-users-row-actions')).toHaveCount(1);

		await page.getByTestId('admin-users-row-actions').click();
		await page.getByTestId('admin-users-action-impersonate').click();

		// The UX fix: impersonation triggers a full navigation into the app (no
		// reload-prompt dialog), then the app boots as the impersonated identity.
		await page.waitForURL(/\/en\/app/, { timeout: 30000 });
		await waitForAuthenticated(page);

		// The impersonation banner is visible and the user menu now shows the
		// impersonated user, proving the app runs under the swapped session.
		await expect(page.getByTestId('impersonation-banner')).toBeVisible({ timeout: 15000 });
		await expect(page.locator('#user-menu-trigger')).toContainText(targetEmail);

		// Stop impersonating from the user menu. This restores the admin session and
		// navigates back to the users table.
		await page.locator('#user-menu-trigger').click();
		await page.getByTestId('app-user-menu-stop-impersonating').click();

		await page.waitForURL(/\/en\/admin\/users/, { timeout: 30000 });
		await page.waitForLoadState('domcontentloaded');
		await expect(page.getByTestId('admin-users-page')).toBeVisible();
		await expect.poll(async () => page.getByTestId('impersonation-banner').count()).toBe(0);

		// The audit log records the stop with the elapsed duration. Search narrows the
		// log to our target, the action filter isolates the stop_impersonation entry.
		await page.goto('/en/admin/audit-log');
		await page.waitForLoadState('domcontentloaded');
		await waitForAuditLogReady(page);
		await expect(page.getByTestId('admin-audit-log-search')).toBeVisible();

		await page.getByTestId('admin-audit-log-search').fill(targetEmail);
		await expect.poll(() => new URL(page.url()).searchParams.get('search')).toBe(targetEmail);
		await expect.poll(async () => page.getByTestId('admin-audit-log-loading').count()).toBe(0);

		await selectActionFilter(page, 'stop_impersonation');
		await expect
			.poll(() => new URL(page.url()).searchParams.get('action'))
			.toBe('stop_impersonation');

		// Every remaining row is a stop against our target, and the details cell
		// reports the impersonation duration ("Lasted ...", possibly 0 sec).
		const badges = (await page.getByTestId('audit-log-action-badge').allTextContents()).map(
			(value) => value.trim()
		);
		expect(badges.length).toBeGreaterThan(0);
		expect(badges.every((label) => label === 'Stop impersonation')).toBe(true);

		await expect(
			page.getByTestId('audit-log-target-cell').filter({ hasText: targetEmail })
		).toHaveCount(1, { timeout: 10000 });
		await expect(page.getByTestId('audit-log-details-cell').first()).toContainText(/Lasted/, {
			timeout: 10000
		});
	});
});
