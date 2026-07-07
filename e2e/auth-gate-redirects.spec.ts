import { test, expect } from '@playwright/test';

/**
 * Guards the two authenticated redirect branches of authFirstPattern in
 * hooks.server.ts that unauthenticated-redirect.spec.ts cannot reach:
 *
 * - the admin role gate: an authenticated non-admin visiting /admin is
 *   307-redirected to /{lang}/app (role claim read from the JWT payload,
 *   re-checked authoritatively in Convex for every admin query)
 * - redirectTo consumption: an authenticated user visiting signin with a
 *   redirectTo param is sent to that destination, not the /{lang}/app default
 *
 * Runs in the chromium project with the regular (non-admin) user session.
 */

test('authenticated non-admin visiting /admin is redirected into the app', async ({ page }) => {
	await page.goto('/admin');

	// Role gate sends non-admins to /{lang}/app, which forwards to the app's
	// default landing route. Never an /admin URL, never signin.
	await page.waitForURL(/\/[a-z]{2}\/app(\/|\?|$)/);
	expect(new URL(page.url()).pathname).not.toContain('/admin');
});

test('authenticated visit to signin honors redirectTo', async ({ page }) => {
	// Target must differ from the /{lang}/app fallback (which forwards to the
	// default landing route), otherwise this would pass with redirectTo ignored.
	await page.goto('/en/signin?redirectTo=%2Fen%2Fapp%2Fsettings');

	await page.waitForURL(/\/en\/app\/settings/);
});
