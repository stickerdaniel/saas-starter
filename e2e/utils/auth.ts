import { expect, type Page } from '@playwright/test';
import { ConvexHttpClient } from 'convex/browser';
import { api } from '../../src/lib/convex/_generated/api';
import { resolveConvexUrl } from './convex-url';
import { getPreviewBypass } from './preview-bypass';
import { resolveSiteUrl } from './site-url';
import type { AccountRole, TestAccount } from './types';

/**
 * Creates an email/password account: Better Auth's sign-up endpoint, then a test
 * mutation that verifies the email, or promotes the account to a verified admin
 * with its notification preferences. Record the email with `ownTestEmail` first,
 * so a run that dies mid-signup still lists the account for teardown.
 *
 * The sign-up request runs once. Global setup has already warmed the auth
 * handler through the signing-key request, so a failed sign-up is a defect to
 * report, and a retry could hide a half-created account behind a duplicate.
 */
export async function createTestAccount(account: TestAccount, role: AccountRole = 'user') {
	const secret = process.env.AUTH_E2E_TEST_SECRET;
	const convexUrl = resolveConvexUrl();
	if (!secret || !convexUrl)
		throw new Error('Test accounts need AUTH_E2E_TEST_SECRET and a backend');
	const siteUrl = resolveSiteUrl();
	const signUp = await fetch(`${siteUrl}/api/auth/sign-up/email`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', Origin: siteUrl, ...getPreviewBypass().headers },
		body: JSON.stringify({ email: account.email, password: account.password, name: account.name })
	});
	if (!signUp.ok) {
		const body = await signUp.text().catch(() => '');
		throw new Error(
			`Sign-up of ${account.email} failed: HTTP ${signUp.status} ${body.slice(0, 300)}`
		);
	}
	const client = new ConvexHttpClient(convexUrl);
	const result =
		role === 'admin'
			? await client.mutation(api.tests.createTestAdminUser, { email: account.email, secret })
			: await client.mutation(api.tests.verifyTestUserEmail, { email: account.email, secret });
	if (!result.success) throw new Error(`Setting up ${account.email} failed: ${result.error}`);
}

/**
 * Wait for an authenticated app page to be loaded, hydrated, and interactive.
 *
 * Two signals, in order, on a single generous budget, and deliberately NO
 * page.reload() on the way:
 *   1. html[data-hydrated] is set unconditionally in the layout's onMount, so it is
 *      independent of the Convex WebSocket. The definitive "Svelte hydrated, event
 *      handlers attached" signal.
 *   2. #user-menu-trigger is the authenticated shell, SSR-rendered from the JWT
 *      viewer, so it paints without waiting on the live session.
 *
 * Why no reload and a large budget: a cold CF preview boots a fresh worker AND a
 * freshly provisioned Convex deployment, and signin navigates with a full page
 * load, so /app starts a cold client + WebSocket. A page.reload() throws that warm
 * boot away and re-pays the entire cold start from zero. Repeated reloads on a
 * too-small per-attempt budget is exactly what made the auth setup cascade-fail on
 * cold previews. One attempt, full budget, lets the boot finish.
 *
 * After this returns, event handlers are attached and elements are interactive.
 */
export async function waitForAuthenticated(page: Page, timeout = 60000) {
	const skip = page.getByRole('button', {
		name: /^(Not now|Nicht jetzt|Ahora no|Pas maintenant)$/
	});
	// Auth invalidation can briefly reach /app before the passkey handoff. Handle
	// the offer while waiting for the interactive shell, not from one URL snapshot.
	await page.addLocatorHandler(skip, () => skip.click(), { times: 1 });
	try {
		await expect(page.locator('html[data-hydrated] #user-menu-trigger')).toBeVisible({ timeout });
		await page.waitForURL((url) => /^\/[a-z]{2}\/app(?:\/|$)/.test(url.pathname), { timeout });
	} finally {
		await page.removeLocatorHandler(skip);
	}
}

/** Submits the sign-in form once its controls are enabled. */
export async function submitSignInForm(page: Page, email: string, password: string) {
	await expect(page.locator('[data-testid="email-input"]')).toBeEnabled({ timeout: 30000 });
	await expect(page.locator('[data-testid="signin-button"]')).toBeEnabled({ timeout: 30000 });
	await page.fill('[data-testid="email-input"]', email);
	await page.fill('[data-testid="password-input"]', password);
	await page.click('[data-testid="signin-button"]');
}

/** Signs a test account in through the form, in a fresh session owned by this page. */
export async function signInAsTestUser(page: Page, account: TestAccount) {
	const { email, password } = account;
	// The form's enabled controls are the readiness signal; waiting for `load`
	// would also wait on the auth panel's image, which sign-in never needs.
	await page.goto('/signin', { waitUntil: 'commit' });
	await submitSignInForm(page, email, password);
	await waitForAuthenticated(page);
}
