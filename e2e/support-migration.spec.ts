import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { ConvexHttpClient } from 'convex/browser';
import { api } from '../src/lib/convex/_generated/api';
import { waitForAuthenticated } from './utils/auth';

dotenv.config({ path: '.env.test' });

/**
 * E2E tests for anonymous support ticket migration.
 *
 * Tests the flow where:
 * 1. Anonymous user creates 105 support tickets (stored with localStorage ID)
 * 2. User authenticates (signs in)
 * 3. System automatically migrates ALL tickets to authenticated account (tests pagination)
 * 4. localStorage supportUserId is cleared
 * 5. Database shows threads now belong to authenticated user with enriched data
 */

interface TestCredentials {
	user: { email: string; password: string; name: string };
	admin: { email: string; password: string; name: string };
	anonymousSupport: { userId: string; threadIds: string[] };
}

const credentialsPath = path.join(process.cwd(), 'e2e', '.auth', 'test-credentials.json');
const testSecret = process.env.AUTH_E2E_TEST_SECRET!;
const convexUrl = process.env.PUBLIC_CONVEX_URL || process.env.VITE_CONVEX_URL;

const readCredentials = (): TestCredentials => {
	if (!fs.existsSync(credentialsPath)) {
		throw new Error('test-credentials.json not found. globalSetup may have failed.');
	}

	return JSON.parse(fs.readFileSync(credentialsPath, 'utf-8')) as TestCredentials;
};

const getConvexClient = () => {
	if (!convexUrl) {
		throw new Error('PUBLIC_CONVEX_URL not configured in .env.test');
	}
	return new ConvexHttpClient(convexUrl);
};

// Uses pre-authenticated session state from signin.setup.ts
test.describe('Support ticket migration', () => {
	test('clears localStorage when anonymous user has zero threads', async ({ page }) => {
		const client = getConvexClient();

		// Create a fresh anonymous ID with NO threads
		const emptyAnonymousId = `anon_${crypto.randomUUID()}`;

		// Verify no threads exist for this ID
		const threads = await client.mutation(api.tests.getSupportThreadsByUserId, {
			secret: testSecret,
			userId: emptyAnonymousId
		});
		expect(threads.length).toBe(0);

		// Set the anonymous ID in localStorage
		await page.addInitScript((id) => {
			localStorage.setItem('supportUserId', id);
		}, emptyAnonymousId);

		// Navigate to app (triggers migration $effect)
		await page.goto('/app');
		await waitForAuthenticated(page);

		// localStorage should be cleared even with 0 threads (migration succeeded)
		await expect
			.poll(() => page.evaluate(() => localStorage.getItem('supportUserId')), { timeout: 30000 })
			.toBeNull();
	});

	test('migrates all 105 anonymous tickets and verifies database reassignment', async ({
		page
	}) => {
		const credentials = readCredentials();
		const client = getConvexClient();

		// Create fresh threads for THIS test attempt (retry-safe)
		// Each retry gets a new anonymousUserId so previous migration doesn't affect it
		const anonymousUserId = `anon_${crypto.randomUUID()}`;
		console.log(`[Test] Creating 105 fresh anonymous threads for userId: ${anonymousUserId}`);

		const { threadIds } = await client.mutation(api.tests.createAnonymousSupportThread, {
			secret: testSecret,
			anonymousUserId,
			title: 'E2E Support Thread',
			pageUrl: '/en/app',
			count: 105
		});
		console.log(`[Test] Created ${threadIds.length} threads`);

		// 1. Verify threads belong to anonymous user BEFORE migration
		const beforeMigration = await client.mutation(api.tests.getSupportThreadsByUserId, {
			secret: testSecret,
			userId: anonymousUserId
		});
		expect(beforeMigration.length).toBe(105);

		// 2. Get the authenticated user's ID for verification after migration
		const { userId: authUserId } = await client.mutation(api.tests.getAuthUserIdByEmail, {
			secret: testSecret,
			email: credentials.user.email
		});
		expect(authUserId).not.toBeNull();

		// 3. Set the seeded anonymous user ID in localStorage before page scripts run
		await page.addInitScript((id) => {
			localStorage.setItem('supportUserId', id);
		}, anonymousUserId);

		// 4. Navigate to the app (which triggers the $effect with migration logic)
		await page.goto('/app');
		await waitForAuthenticated(page);

		// 5. Wait for localStorage to be cleared (indicates migration complete)
		await expect
			.poll(() => page.evaluate(() => localStorage.getItem('supportUserId')), { timeout: 60000 })
			.toBeNull();

		// 6. Verify ALL 105 threads now belong to authenticated user
		const afterMigration = await client.mutation(api.tests.getSupportThreadsByUserId, {
			secret: testSecret,
			userId: authUserId!
		});
		expect(afterMigration.length).toBe(105);

		// 7. Verify threads are no longer under anonymous user
		const remainingAnonymous = await client.mutation(api.tests.getSupportThreadsByUserId, {
			secret: testSecret,
			userId: anonymousUserId
		});
		expect(remainingAnonymous.length).toBe(0);

		// 8. Verify user data was populated on migrated threads
		const sampleThread = afterMigration[0];
		expect(sampleThread.userName).toBe(credentials.user.name);
		expect(sampleThread.userEmail).toBe(credentials.user.email);

		// Note: UI verification skipped - test threads have no messages so they're
		// filtered out by the widget (threads-overview.svelte filters by lastMessage).
		// Database assertions above prove migration worked correctly.

		// Cleanup: Delete the threads we created for this test
		console.log(`[Test] Cleaning up ${threadIds.length} threads`);
		await client.mutation(api.tests.cleanupAnonymousSupportThreads, {
			secret: testSecret,
			threadIds
		});
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
