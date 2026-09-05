import { test, expect, type Page, type Route } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import 'varlock/auto-load';
import { ConvexHttpClient } from 'convex/browser';
import { api } from '../src/lib/convex/_generated/api';
import { resolveConvexUrl } from './utils/convex-url';
import { resolveSiteUrl } from './utils/site-url';
import { getPreviewBypass } from './utils/preview-bypass';

// This test runs without auth state - tests unauthenticated behavior
test.use({ storageState: { cookies: [], origins: [] } });

// All gotos pin the locale: unprefixed paths are redirected by
// src/hooks.server.ts based on Accept-Language (see the precedent in
// e2e/upgrade-checkout-failure.spec.ts), which would serve translated copy
// on non-English runners.
//
// Überall Englisch außer im Recovery-Durchlauf unten, der bewusst Deutsch
// festlegt: das Locale-Präfix gehört zu dem, was die Kette überleben muss, und
// auf der Standardsprache sähen verlorenes und erhaltenes Präfix gleich aus.
// Jener Test wählt über Test-IDs, die Übersetzung kostet ihn also nichts.

import type { TestCredentials } from './utils/types';

const testSecret = process.env.AUTH_E2E_TEST_SECRET!;

function getSeededUserEmail(): string {
	const credentialsPath = path.join(process.cwd(), 'e2e', '.auth', 'test-credentials.json');
	if (!fs.existsSync(credentialsPath)) {
		throw new Error('test-credentials.json not found. globalSetup may have failed.');
	}
	const credentials: TestCredentials = JSON.parse(fs.readFileSync(credentialsPath, 'utf-8'));
	return credentials.user.email;
}

async function submitForgotPassword(page: Page, email: string) {
	await page.goto('/en/forgot-password');
	await page.waitForLoadState('domcontentloaded');
	await expect(page.getByTestId('forgot-password-email-input')).toBeEnabled({ timeout: 30000 });
	// Asserted before the submit as well, so that the after-check below cannot pass
	// by the element having never rendered.
	await expect(page.getByTestId('forgot-password-description')).toBeVisible();
	await page.getByTestId('forgot-password-email-input').fill(email);
	await page.getByTestId('forgot-password-submit-button').click();
	const message = page.getByTestId('forgot-password-success-message');
	await expect(message).toBeVisible({ timeout: 10000 });
	// The subtitle promises a mail outright. Leaving it up next to the conditional
	// message would put both claims on screen at once, which is the overstatement
	// the conditional wording exists to remove.
	await expect(page.getByTestId('forgot-password-description')).toHaveCount(0);
	return (await message.innerText()).trim();
}

const getConvexClient = () => {
	const convexUrl = resolveConvexUrl();
	if (!convexUrl) {
		throw new Error('Convex URL not configured (set PUBLIC_CONVEX_URL or start local dev server)');
	}
	return new ConvexHttpClient(convexUrl);
};

test.describe('Forgot Password', () => {
	test('shows validation error for invalid email', async ({ page }) => {
		await page.goto('/en/forgot-password');
		await page.waitForLoadState('domcontentloaded');
		await expect(page.getByTestId('forgot-password-email-input')).toBeEnabled({ timeout: 30000 });
		await expect(page.getByTestId('forgot-password-submit-button')).toBeEnabled({
			timeout: 30000
		});

		// Try to submit with invalid email (browser validation disabled with novalidate)
		await page.getByTestId('forgot-password-email-input').fill('notanemail');
		await page.getByTestId('forgot-password-submit-button').click();

		// Should show our styled validation error
		await expect(page.getByTestId('forgot-password-email-error')).toBeVisible({ timeout: 5000 });

		// Should still be on forgot-password page
		await expect(page).toHaveURL(/forgot-password/);
	});

	test('shows success message after valid email submission', async ({ page }) => {
		await page.goto('/en/forgot-password');
		await page.waitForLoadState('domcontentloaded');
		await expect(page.getByTestId('forgot-password-email-input')).toBeEnabled({ timeout: 30000 });
		await expect(page.getByTestId('forgot-password-submit-button')).toBeEnabled({
			timeout: 30000
		});

		// Submit with valid email (doesn't need to exist for this test)
		await page.getByTestId('forgot-password-email-input').fill('test@example.com');
		await page.getByTestId('forgot-password-submit-button').click();

		// Should show success message (API returns success even for non-existent emails — security best practice)
		await expect(page.getByTestId('forgot-password-success-message')).toBeVisible({
			timeout: 10000
		});
	});

	/**
	 * Account enumeration guard. Better Auth answers /request-password-reset
	 * identically whether or not the address has an account, and the screen must
	 * not undo that by rendering something the API never told it. Submitting a
	 * seeded address and an address that cannot exist has to leave the user
	 * looking at the same words.
	 */
	test('says the same thing for a known and an unknown address', async ({ page }) => {
		const known = await submitForgotPassword(page, getSeededUserEmail());
		const unknown = await submitForgotPassword(
			page,
			`definitely-not-registered-${Date.now()}@e2e.example.com`
		);

		expect(known).toBe(unknown);
		// The wording stays conditional: the endpoint reports success even when the
		// address has no account, and Better Auth swallows a failing send, so the
		// screen can claim neither that an account exists nor that mail went out.
		expect(known.toLowerCase()).toContain('if an account exists');
	});

	// The answer names the address it was given, so it must not outlive that
	// address in the field. Nothing clears it on the next submit either, because a
	// validation failure returns before the reset.
	test('drops the answer when the address changes', async ({ page }) => {
		await submitForgotPassword(page, `stale-${Date.now()}@e2e.example.com`);

		await page.getByTestId('forgot-password-email-input').fill('not-an-email');

		await expect(page.getByTestId('forgot-password-success-message')).toHaveCount(0);
		await expect(page.getByTestId('forgot-password-description')).toBeVisible();
	});

	/**
	 * The subtitle promises a mail outright, so it has to give way to any answer,
	 * not only to a successful one. The failing request is faked because a real
	 * backend failure is not reachable from a test.
	 */
	test('drops the delivery promise when the request fails', async ({ page }) => {
		await page.route('**/request-password-reset', (route: Route) =>
			route.fulfill({
				status: 500,
				contentType: 'application/json',
				body: JSON.stringify({ message: 'Internal Server Error' })
			})
		);
		await page.goto('/en/forgot-password');
		await page.waitForLoadState('domcontentloaded');
		await expect(page.getByTestId('forgot-password-email-input')).toBeEnabled({ timeout: 30000 });
		await expect(page.getByTestId('forgot-password-description')).toBeVisible();

		await page.getByTestId('forgot-password-email-input').fill('someone@e2e.example.com');
		await page.getByTestId('forgot-password-submit-button').click();

		await expect(page.getByTestId('forgot-password-form-error')).toBeVisible({ timeout: 10000 });
		await expect(page.getByTestId('forgot-password-description')).toHaveCount(0);
		await expect(page.getByTestId('forgot-password-success-message')).toHaveCount(0);
	});

	test('navigates back to signin', async ({ page }) => {
		await page.goto('/en/forgot-password');
		await page.waitForLoadState('domcontentloaded');

		// Click back to sign in link
		await page.getByTestId('forgot-password-back-link').click();

		// Should navigate to signin
		await expect(page).toHaveURL(/signin/);
	});
});

test.describe('Reset Password', () => {
	test('shows error when token is missing', async ({ page }) => {
		await page.goto('/en/reset-password');
		await page.waitForLoadState('domcontentloaded');
		await expect(page.getByTestId('reset-password-password-input')).toBeEnabled({
			timeout: 30000
		});
		await expect(page.getByTestId('reset-password-submit-button')).toBeEnabled({
			timeout: 30000
		});

		// Fill in passwords
		await page.getByTestId('reset-password-password-input').fill('NewPassword123');
		await page.getByTestId('reset-password-confirm-input').fill('NewPassword123');

		// Submit
		await page.getByTestId('reset-password-submit-button').click();

		// Should show error about missing token
		const formError = page.getByTestId('reset-password-form-error');
		await expect(formError).toBeVisible({ timeout: 5000 });
	});

	test('shows validation error for password mismatch', async ({ page }) => {
		// Navigate with a dummy token (will fail on submit, but we can test client validation)
		await page.goto('/en/reset-password?token=dummy-token');
		await page.waitForLoadState('domcontentloaded');
		await expect(page.getByTestId('reset-password-password-input')).toBeEnabled({
			timeout: 30000
		});
		await expect(page.getByTestId('reset-password-submit-button')).toBeEnabled({
			timeout: 30000
		});

		// Fill in mismatched passwords
		await page.getByTestId('reset-password-password-input').fill('Password123');
		await page.getByTestId('reset-password-confirm-input').fill('DifferentPassword123');

		// Submit
		await page.getByTestId('reset-password-submit-button').click();

		// Should show mismatch error on the confirm field
		await expect(page.getByTestId('reset-password-confirm-error')).toBeVisible({
			timeout: 5000
		});
	});

	test('shows validation error for weak password', async ({ page }) => {
		await page.goto('/en/reset-password?token=dummy-token');
		await page.waitForLoadState('domcontentloaded');
		await expect(page.getByTestId('reset-password-password-input')).toBeEnabled({
			timeout: 30000
		});
		await expect(page.getByTestId('reset-password-submit-button')).toBeEnabled({
			timeout: 30000
		});

		// Fill in weak password (no uppercase)
		await page.getByTestId('reset-password-password-input').fill('weakpass1');
		await page.getByTestId('reset-password-confirm-input').fill('weakpass1');

		// Submit
		await page.getByTestId('reset-password-submit-button').click();

		// Should show password requirement errors on the password field
		await expect(page.getByTestId('reset-password-password-error')).toBeVisible({
			timeout: 5000
		});
	});

	test('navigates back to signin', async ({ page }) => {
		await page.goto('/en/reset-password?token=dummy');
		await page.waitForLoadState('domcontentloaded');

		// Click back to sign in link
		await page.getByTestId('reset-password-back-link').click();

		// Should navigate to signin
		await expect(page).toHaveURL(/signin/);
	});

	/**
	 * Cheaper layers rejected because: Hier versagt eine Kette echter Navigationen,
	 * die keine billigere Schicht ausführt. Better Auths Redirect vom Reset-Link,
	 * der Hook darauf und die folgende Anmeldung sind drei ausgelieferte Round
	 * Trips, und geprüft wird die URL, auf der der Browser am Ende steht,
	 * einschließlich Fragment: Browser-Zustand, kein Response-Body. Ein
	 * Request-only-Spec erreicht das ebenfalls nicht, denn jeder Schritt läuft über
	 * einen gerenderten Link, und genau ein gerenderter Link verlor das Ziel.
	 *
	 * Läuft auf dem Revocation-Setup mit, statt es zu wiederholen: Konto anlegen,
	 * verifizieren und anmelden ist der größte Teil beider Kosten.
	 */
	test('recovering a password revokes other sessions and keeps the destination', async ({
		page,
		playwright
	}) => {
		const client = getConvexClient();
		const siteUrl = resolveSiteUrl();
		const bypass = getPreviewBypass();

		// Tief, lokalisiert, mit Query und Fragment: das Fragment lehnt die
		// Callback-Grammatik rundweg ab, und `tab=profile` kennt die Seite absichtlich
		// nicht, damit jedes Neuberechnen statt Durchreichen auffällt.
		const destination = '/de/app/settings?tab=profile#section';
		const encodedDestination = encodeURIComponent(destination);
		const resetCallback = `/de/reset-password?redirectTo=${encodedDestination}`;

		// Dedicated user: resetting the shared test user's password would break other specs
		const email = `test-reset-revoke-${Date.now()}@e2e.example.com`;
		const password = 'OldPassword123!';
		const newPassword = 'NewPassword456!';

		// Separate cookie jar simulating another device's session that the reset must revoke
		const otherSession = await playwright.request.newContext({
			baseURL: siteUrl,
			extraHTTPHeaders: { Origin: siteUrl, ...bypass.headers }
		});

		try {
			const signUp = await otherSession.post('/api/auth/sign-up/email', {
				data: { email, password, name: 'E2E Reset Revoke' }
			});
			expect(signUp.ok()).toBeTruthy();

			const verifyResult = await client.mutation(api.tests.verifyTestUserEmail, {
				email,
				secret: testSecret
			});
			expect(verifyResult.success).toBeTruthy();

			// Establish the session that should be revoked by the password reset
			const signIn = await otherSession.post('/api/auth/sign-in/email', {
				data: { email, password }
			});
			expect(signIn.ok()).toBeTruthy();

			const sessionBefore = await otherSession.get('/api/auth/get-session');
			expect(await sessionBefore.json()).not.toBeNull();

			// Start wie nach einem Gate: auf der Anmeldung, mit dem Ziel im Gepäck.
			const signInPath = `/de/signin?redirectTo=${encodedDestination}`;

			// Serverseitiges Markup, vor jedem Skript. Der hydrierte Href unten allein
			// trennt die Fälle nicht: aus einem Browser-Cache gelesen bliebe er richtig,
			// während der erste Paint das Ziel schon verloren hätte. `resolve` liefert
			// beim SSR einen relativen Href, deshalb wird nur der Query geprüft.
			const serverHtml = await (await page.request.get(signInPath)).text();
			expect(serverHtml).toContain(`forgot-password?redirectTo=${encodedDestination}`);

			await page.goto(signInPath);
			await page.waitForLoadState('domcontentloaded');
			const forgotLink = page.getByTestId('signin-forgot-password-link');
			await expect(forgotLink).toHaveAttribute(
				'href',
				`/de/forgot-password?redirectTo=${encodedDestination}`
			);

			await forgotLink.click();
			await expect(page).toHaveURL(`/de/forgot-password?redirectTo=${encodedDestination}`);

			// Reset wie ein Nutzer anfordern und lesen, was die Seite wirklich sendet.
			// Delivery is skipped for @e2e.example.com addresses, so the token is read
			// from the backend's verification model instead of a mailbox.
			await expect(page.getByTestId('forgot-password-email-input')).toBeEnabled({ timeout: 30000 });
			await page.getByTestId('forgot-password-email-input').fill(email);
			const resetRequest = page.waitForRequest(
				(request) =>
					request.url().includes('/request-password-reset') && request.method() === 'POST'
			);
			await page.getByTestId('forgot-password-submit-button').click();
			await expect(page.getByTestId('forgot-password-success-message')).toBeVisible({
				timeout: 10000
			});
			// Die Reset-SEITE mit dem Ziel eine Ebene tiefer. Das Ziel selbst hier
			// einzutragen hieße, ein gültiges Token daran zu hängen.
			expect((await resetRequest).postDataJSON()).toMatchObject({
				email,
				redirectTo: resetCallback
			});

			const { token } = await client.mutation(api.tests.getPasswordResetToken, {
				email,
				secret: testSecret
			});
			expect(token).toBeTruthy();

			// Der Link aus der Mail, keine selbst gebaute Reset-URL: an diesem Endpunkt
			// entscheidet Better Auth, was das Formular bekommt.
			await page.goto(
				`/api/auth/reset-password/${token}?callbackURL=${encodeURIComponent(resetCallback)}`
			);
			await page.waitForLoadState('domcontentloaded');
			const onResetForm = new URL(page.url());
			expect(onResetForm.pathname).toBe('/de/reset-password');
			expect(onResetForm.searchParams.get('token')).toBeTruthy();
			expect(onResetForm.searchParams.get('redirectTo')).toBe(destination);

			await expect(page.getByTestId('reset-password-password-input')).toBeEnabled({
				timeout: 30000
			});
			await page.getByTestId('reset-password-password-input').fill(newPassword);
			await page.getByTestId('reset-password-confirm-input').fill(newPassword);
			await page.getByTestId('reset-password-submit-button').click();
			await expect(page.getByTestId('reset-password-success-message')).toBeVisible({
				timeout: 10000
			});

			// revokeSessionsOnPasswordReset must have invalidated the other session
			const sessionAfter = await otherSession.get('/api/auth/get-session');
			expect(await sessionAfter.json()).toBeNull();

			// Das Angebot der Erfolgsmeldung, die letzte Stelle, an der das Ziel
			// verloren gehen kann. Das verbrauchte Token bleibt zurück.
			const signInLink = page.getByTestId('reset-password-signin-link');
			await expect(signInLink).toHaveAttribute(
				'href',
				`/de/signin?redirectTo=${encodedDestination}`
			);
			await signInLink.click();
			await expect(page).toHaveURL(`/de/signin?redirectTo=${encodedDestination}`);

			await expect(page.getByTestId('email-input')).toBeEnabled({ timeout: 30000 });
			await page.getByTestId('email-input').fill(email);
			await page.getByTestId('password-input').fill(newPassword);
			const signInSubmission = page.waitForRequest(
				(request) => request.url().includes('/sign-in/email') && request.method() === 'POST'
			);
			await page.getByTestId('signin-button').click();

			// Better Auth liest dieses Feld zweimal; auf dem Ablehnungspfad wird daraus
			// der Recovery-Link. Es trägt das Ziel, statt es zu sein, weil die geprüfte
			// Grammatik kein Fragment erlaubt. Feldweise gelesen, damit ein Fehlschlag
			// nie den Body mit dem Passwort ausgibt.
			const signInBody = (await signInSubmission).postDataJSON();
			expect(signInBody.email).toBe(email);
			expect(signInBody.callbackURL).toBe(`/de/signin?redirectTo=${encodedDestination}`);

			await expect(page).toHaveURL(destination, { timeout: 30000 });
			const landed = new URL(page.url());
			expect(`${landed.pathname}${landed.search}${landed.hash}`).toBe(destination);
		} finally {
			await otherSession.dispose();
			await client
				.mutation(api.tests.deleteTestUser, { email, secret: testSecret })
				.catch(() => {});
		}
	});
});
