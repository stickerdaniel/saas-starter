import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { waitForAuthenticated } from './utils/auth';

/**
 * E2E tests for anonymous support ticket migration.
 *
 * Tests the flow where:
 * 1. Anonymous user creates support tickets (stored with localStorage ID)
 * 2. User authenticates (signs in)
 * 3. System automatically migrates tickets to authenticated account
 * 4. localStorage supportUserId is cleared
 */

interface TestCredentials {
	user: { email: string; password: string; name: string };
	admin: { email: string; password: string; name: string };
	anonymousSupport: { userId: string; threadId: string };
}

const credentialsPath = path.join(process.cwd(), 'e2e', '.auth', 'test-credentials.json');

const readCredentials = (): TestCredentials => {
	if (!fs.existsSync(credentialsPath)) {
		throw new Error('test-credentials.json not found. globalSetup may have failed.');
	}

	return JSON.parse(fs.readFileSync(credentialsPath, 'utf-8')) as TestCredentials;
};

// Uses pre-authenticated session state from signin.setup.ts
test.describe('Support ticket migration', () => {
	test('migrates anonymous tickets when user logs in', async ({ page }) => {
		const credentials = readCredentials();
		const anonymousUserId = credentials.anonymousSupport.userId;

		if (!anonymousUserId) {
			throw new Error('anonymousSupport.userId missing from test credentials');
		}

		// Set the seeded anonymous user ID in localStorage before page scripts run
		await page.addInitScript((id) => {
			localStorage.setItem('supportUserId', id);
		}, anonymousUserId);

		// Navigate to the app (which triggers the $effect with migration logic)
		await page.goto('/app');
		await waitForAuthenticated(page);

		// The localStorage should be cleared after successful migration
		// (even if no threads were actually migrated)
		// Increase timeout for CI where auth state takes longer to load
		await expect
			.poll(() => page.evaluate(() => localStorage.getItem('supportUserId')), { timeout: 30000 })
			.toBeNull();
	});

	test('preserves localStorage on migration failure', async ({ page }) => {
		// Set an INVALID anonymous ID before page scripts run
		const invalidId = 'invalid-not-anon-prefix';
		await page.addInitScript((id) => {
			localStorage.setItem('supportUserId', id);
		}, invalidId);

		// Navigate to app - the effect runs but should fail validation
		// and NOT clear localStorage (allows retry)
		await page.goto('/app');
		await waitForAuthenticated(page);

		// With invalid ID, the isAnonymousUser check should fail
		// so the migration won't even be attempted, and localStorage remains
		const remainingId = await page.evaluate(() => localStorage.getItem('supportUserId'));
		expect(remainingId).toBe(invalidId);

		// Clean up
		await page.evaluate(() => localStorage.removeItem('supportUserId'));
	});

	test('does nothing when no anonymous ID exists', async ({ page }) => {
		// Ensure no supportUserId before page scripts run
		await page.addInitScript(() => {
			localStorage.removeItem('supportUserId');
		});

		await page.goto('/app');
		await waitForAuthenticated(page);

		// Should complete without errors
		const storedId = await page.evaluate(() => localStorage.getItem('supportUserId'));
		expect(storedId).toBeNull();
	});
});
