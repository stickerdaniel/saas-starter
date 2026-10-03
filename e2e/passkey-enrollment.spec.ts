import { test, expect } from '@playwright/test';
import { ConvexHttpClient } from 'convex/browser';
import { api } from '../src/lib/convex/_generated/api';
import { resolveConvexUrl } from './utils/convex-url';
import { resolveSiteUrl } from './utils/site-url';
import { submitSignInForm } from './utils/auth';
import { getPreviewBypass } from './utils/preview-bypass';
import { ownTestEmail } from './utils/owned-test-data';

// Cheaper layers rejected because: the authenticated route handoff, browser
// WebAuthn ceremony, and persisted registration must agree on the deployed
// origin. A request-only check cannot perform the authenticator ceremony.
test.use({ storageState: { cookies: [], origins: [] } });

const password = 'PasskeyTestPassword123!';
const destination = '/en/app/community-chat?source=passkey-test#latest';
const client = () => new ConvexHttpClient(resolveConvexUrl()!);
const secret = () => process.env.AUTH_E2E_TEST_SECRET!;

test('offers, registers and uses a passkey while preserving the destination', async ({
	page
}, testInfo) => {
	const email = `passkey-${Date.now()}@e2e.example.com`;
	ownTestEmail(email, 'userEmails');
	try {
		const signup = await page.request.post('/api/auth/sign-up/email', {
			headers: { Origin: resolveSiteUrl() },
			data: { email, password, name: 'Daniel Example' }
		});
		expect(signup.ok()).toBe(true);
		await client().mutation(api.tests.verifyTestUserEmail, { email, secret: secret() });
		await page.context().clearCookies();
		const cdp = await page.context().newCDPSession(page);
		await cdp.send('WebAuthn.enable');
		const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
			options: {
				protocol: 'ctap2',
				transport: 'internal',
				hasResidentKey: true,
				hasUserVerification: true,
				isUserVerified: true,
				automaticPresenceSimulation: true
			}
		});
		await page.goto(`/en/signin?redirectTo=${encodeURIComponent(destination)}`);
		await submitSignInForm(page, email, password);
		await expect(
			page.getByRole('heading', { name: 'Make your next sign-in easier' })
		).toBeVisible();
		expect(
			(await cdp.send('WebAuthn.getCredentials', { authenticatorId })).credentials
		).toHaveLength(0);
		await page.setViewportSize({ width: 1440, height: 900 });
		await page.screenshot({ path: testInfo.outputPath('passkey-desktop.png') });
		await page.setViewportSize({ width: 390, height: 844 });
		await page.screenshot({ path: testInfo.outputPath('passkey-mobile.png') });
		await page.getByLabel('Passkey name', { exact: true }).fill('E2E passkey');
		await page.getByRole('button', { name: 'Create a passkey', exact: true }).click();
		await expect(page).toHaveURL(destination);
		await expect(page.getByText('Passkey added successfully', { exact: true })).toBeVisible();
		const registered = await (
			await page.request.get('/api/auth/passkey/list-user-passkeys')
		).json();
		expect(registered).toHaveLength(1);
		expect(registered[0].name).toBe('E2E passkey');
		expect(
			await page.evaluate(() => JSON.parse(localStorage.getItem('auth:last-auth-method') ?? 'null'))
		).toBeNull();
		await page.screenshot({ path: testInfo.outputPath('passkey-success.png') });
		await page.setViewportSize({ width: 1440, height: 900 });

		await page.request.post('/api/auth/sign-out', { headers: { Origin: resolveSiteUrl() } });
		await page.context().clearCookies();
		await page.goto(`/en/signin?redirectTo=${encodeURIComponent(destination)}`);
		await submitSignInForm(page, email, password);
		await expect(page).toHaveURL(destination);
		await expect(page.getByRole('heading', { name: 'Make your next sign-in easier' })).toHaveCount(
			0
		);

		await page.request.post('/api/auth/sign-out', { headers: { Origin: resolveSiteUrl() } });
		await page.context().clearCookies();
		await page.goto('/en/signin');
		await page.getByRole('button', { name: 'Sign in with Passkey', exact: true }).click();
		await expect(page.locator('#user-menu-trigger')).toBeVisible();
		expect(
			await page.evaluate(() => JSON.parse(localStorage.getItem('auth:last-auth-method') ?? 'null'))
		).toBe('passkey');
	} finally {
		await client().mutation(api.tests.deleteTestUser, { email, secret: secret() });
	}
});

// Cheaper layers rejected because: this verifies that the authenticated backend
// remembers the choice across sessions and browsers, beyond localStorage.
test('remembers Not now on another browser for the same account', async ({ page, browser }) => {
	const email = `passkey-defer-${Date.now()}@e2e.example.com`;
	ownTestEmail(email, 'userEmails');
	try {
		const signup = await page.request.post('/api/auth/sign-up/email', {
			headers: { Origin: resolveSiteUrl() },
			data: { email, password, name: 'Passkey Deferral' }
		});
		expect(signup.ok()).toBe(true);
		await client().mutation(api.tests.verifyTestUserEmail, { email, secret: secret() });
		await page.context().clearCookies();
		await page.goto('/en/signin');
		await submitSignInForm(page, email, password);
		await page.getByRole('button', { name: 'Not now', exact: true }).click();
		await expect(page.locator('#user-menu-trigger')).toBeVisible();
		const otherBrowser = await browser.newContext({
			storageState: { cookies: [], origins: [] },
			extraHTTPHeaders: getPreviewBypass().headers
		});
		try {
			const otherPage = await otherBrowser.newPage();
			await otherPage.goto(`${resolveSiteUrl()}/en/signin`);
			await submitSignInForm(otherPage, email, password);
			await expect(otherPage.locator('#user-menu-trigger')).toBeVisible();
			await expect(
				otherPage.getByRole('heading', { name: 'Make your next sign-in easier' })
			).toHaveCount(0);
		} finally {
			await otherBrowser.close();
		}
	} finally {
		await client().mutation(api.tests.deleteTestUser, { email, secret: secret() });
	}
});

// Cheaper layers rejected because: the sidebar remounts its content when the viewport crosses
// the mobile breakpoint, and only a real browser layout reproduces that switch.
test('keeps the OAuth offer in the sidebar across the mobile breakpoint', async ({ page }) => {
	const email = `passkey-sidebar-${Date.now()}@e2e.example.com`;
	ownTestEmail(email, 'userEmails');
	try {
		const signup = await page.request.post('/api/auth/sign-up/email', {
			headers: { Origin: resolveSiteUrl() },
			data: { email, password, name: 'Passkey Sidebar' }
		});
		expect(signup.ok()).toBe(true);
		await client().mutation(api.tests.verifyTestUserEmail, { email, secret: secret() });
		await page.context().clearCookies();
		const signin = await page.request.post('/api/auth/sign-in/email', {
			headers: { Origin: resolveSiteUrl() },
			data: { email, password }
		});
		expect(signin.ok()).toBe(true);
		await page.setViewportSize({ width: 1440, height: 900 });
		await page.goto('/en/terms');
		// The marker the Google callback leaves behind; a real provider round trip is out of reach.
		await page.evaluate(() =>
			sessionStorage.setItem('auth:pending-oauth-provider', JSON.stringify('google'))
		);
		await page.goto('/en/app/community-chat');
		const name = page.getByRole('textbox', { name: 'Passkey name', exact: true });
		await expect(name).toBeVisible();
		await page.setViewportSize({ width: 390, height: 844 });
		await page.getByRole('button', { name: 'Toggle Sidebar', exact: true }).click();
		await expect(name).toBeVisible();
		await page.getByRole('button', { name: 'Not now', exact: true }).click();
		await expect(name).toHaveCount(0);
	} finally {
		await client().mutation(api.tests.deleteTestUser, { email, secret: secret() });
	}
});
