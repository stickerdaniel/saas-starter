import { test, expect } from '@playwright/test';

/**
 * Guards the SSR auth gate in hooks.server.ts (authFirstPattern): a visitor
 * without auth cookies must never reach a protected route; the server
 * redirects to the language-aware signin page and preserves the destination
 * in redirectTo.
 *
 * Runs in the chromium-no-auth project, which has no storageState, so the
 * browser sends no cookies at all. This works identically against the local
 * dev:test stack and remote preview deployments.
 *
 * Deliberately NOT tested here: a forged JWT cookie (valid structure, wrong
 * signature). decodeJwtPayload decodes without signature verification for
 * fast first-paint decisions; the authoritative check happens in Convex (see
 * src/lib/server/jwt.ts). The /app gate is presence-only, so a forged cookie
 * renders the app shell with every Convex query rejected — there is no
 * redirect to assert. The /admin gate additionally routes on the unverified
 * role claim (tokens without role admin 307 to /{lang}/app), re-checked
 * authoritatively in Convex for every admin query.
 */

test('unauthenticated visit to /app redirects to signin', async ({ page }) => {
	await page.goto('/app');
	await page.waitForURL(/\/[a-z]{2}\/signin\?/);

	const redirectTo = new URL(page.url()).searchParams.get('redirectTo');
	expect(redirectTo).toMatch(/^\/[a-z]{2}\/app$/);
});

test('unauthenticated visit to /admin redirects to signin', async ({ page }) => {
	await page.goto('/admin');
	await page.waitForURL(/\/[a-z]{2}\/signin\?/);

	const redirectTo = new URL(page.url()).searchParams.get('redirectTo');
	expect(redirectTo).toMatch(/^\/[a-z]{2}\/admin$/);
});
