import { expect, type Page } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import type { TestCredentials } from './types';

/** Reads the seeded test users from e2e/.auth/test-credentials.json (created by globalSetup). */
export function readTestCredentials(): TestCredentials {
	const credentialsPath = path.join(process.cwd(), 'e2e', '.auth', 'test-credentials.json');

	if (!fs.existsSync(credentialsPath)) {
		throw new Error('test-credentials.json not found. globalSetup may have failed.');
	}

	return JSON.parse(fs.readFileSync(credentialsPath, 'utf-8'));
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
	await page.waitForURL(/\/[a-z]{2}\/app/, { timeout });
	await page.locator('html[data-hydrated]').waitFor({ timeout });
	await expect(page.locator('#user-menu-trigger')).toBeVisible({ timeout: 15000 });
}

/** Submits the sign-in form once its controls are enabled. */
export async function submitSignInForm(page: Page, email: string, password: string) {
	await expect(page.locator('[data-testid="email-input"]')).toBeEnabled({ timeout: 30000 });
	await expect(page.locator('[data-testid="signin-button"]')).toBeEnabled({ timeout: 30000 });
	await page.fill('[data-testid="email-input"]', email);
	await page.fill('[data-testid="password-input"]', password);
	await page.click('[data-testid="signin-button"]');
}

/** Signs the seeded regular test user in to a fresh session owned by this page. */
export async function signInAsTestUser(page: Page) {
	const { email, password } = readTestCredentials().user;
	await page.goto('/signin');
	await submitSignInForm(page, email, password);
	await waitForAuthenticated(page);
}
