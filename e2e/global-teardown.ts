/**
 * Playwright Global Teardown
 *
 * Runs after all tests complete to clean up test data.
 * Removes adminNotificationPreferences entries with test email patterns
 * (test-e2e-*, test-dup-*, test-remove-*). Does NOT delete test user accounts.
 */

import { ConvexHttpClient } from 'convex/browser';
import { api } from '../src/lib/convex/_generated/api';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.test' });

async function globalTeardown() {
	const testSecret = process.env.AUTH_E2E_TEST_SECRET;
	const convexUrl = process.env.PUBLIC_CONVEX_URL || process.env.VITE_CONVEX_URL;

	if (!testSecret || !convexUrl) {
		console.warn('[Teardown] Missing AUTH_E2E_TEST_SECRET or CONVEX_URL - skipping cleanup');
		return;
	}

	console.log('[Teardown] Cleaning up E2E test data...');

	try {
		const client = new ConvexHttpClient(convexUrl);
		const result = await client.mutation(api.tests.cleanupTestData, {
			secret: testSecret
		});

		if (result.success) {
			console.log(`[Teardown] ${result.message}`);
		} else {
			console.error('[Teardown] Cleanup failed');
		}
	} catch (error) {
		// Don't fail the test run if cleanup fails
		console.error('[Teardown] Cleanup error:', error);
	}
}

export default globalTeardown;
