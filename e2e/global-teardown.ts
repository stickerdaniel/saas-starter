/**
 * Playwright Global Teardown
 *
 * Runs after all tests complete to clean up:
 * 1. Test users created in global-setup.ts (deleted from database)
 * 2. Test artifacts (notification preferences with test email patterns)
 */

import { ConvexHttpClient } from 'convex/browser';
import { api } from '../src/lib/convex/_generated/api';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

dotenv.config({ path: '.env.test' });

interface TestCredentials {
	user: { email: string; password: string; name: string };
	admin: { email: string; password: string; name: string };
	anonymousSupport: { userId: string; threadId: string };
}

async function globalTeardown() {
	const testSecret = process.env.AUTH_E2E_TEST_SECRET;
	const convexUrl = process.env.PUBLIC_CONVEX_URL || process.env.VITE_CONVEX_URL;

	if (!testSecret || !convexUrl) {
		console.warn('[Teardown] Missing AUTH_E2E_TEST_SECRET or CONVEX_URL - skipping cleanup');
		return;
	}

	console.log('[Teardown] Cleaning up E2E test data...');

	const client = new ConvexHttpClient(convexUrl);

	// Read credentials file to get user emails
	const credentialsPath = path.join(process.cwd(), 'e2e', '.auth', 'test-credentials.json');

	if (fs.existsSync(credentialsPath)) {
		try {
			const credentials: TestCredentials = JSON.parse(fs.readFileSync(credentialsPath, 'utf-8'));

			// Clean up anonymous support threads
			if (credentials.anonymousSupport?.threadId) {
				console.log('[Teardown] Deleting anonymous support threads');
				try {
					await client.mutation(api.tests.cleanupAnonymousSupportThreads, {
						secret: testSecret,
						threadIds: [credentials.anonymousSupport.threadId]
					});
				} catch (error) {
					console.warn(`[Teardown] Failed to delete support threads: ${error}`);
				}
			}

			// Delete test users
			console.log(`[Teardown] Deleting user: ${credentials.user.email}`);
			try {
				await client.mutation(api.tests.deleteTestUser, {
					email: credentials.user.email,
					secret: testSecret
				});
			} catch (error) {
				console.warn(`[Teardown] Failed to delete user: ${error}`);
			}

			console.log(`[Teardown] Deleting admin: ${credentials.admin.email}`);
			try {
				await client.mutation(api.tests.deleteTestUser, {
					email: credentials.admin.email,
					secret: testSecret
				});
			} catch (error) {
				console.warn(`[Teardown] Failed to delete admin: ${error}`);
			}

			// Remove credentials file
			fs.unlinkSync(credentialsPath);
			console.log('[Teardown] Credentials file removed');
		} catch (error) {
			console.warn('[Teardown] Error reading credentials file:', error);
		}
	} else {
		console.log('[Teardown] No credentials file found - skipping user deletion');
	}

	// Clean up test artifacts (notification preferences, etc.)
	try {
		const result = await client.mutation(api.tests.cleanupTestData, {
			secret: testSecret
		});

		if (result.success) {
			console.log(`[Teardown] ${result.message}`);
		}
	} catch (error) {
		console.error('[Teardown] Artifact cleanup error:', error);
	}

	console.log('[Teardown] Cleanup complete');
}

export default globalTeardown;
