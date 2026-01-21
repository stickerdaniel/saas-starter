/**
 * Playwright Global Setup
 *
 * Creates fresh test users with unique emails for each test run.
 * Users are deleted in global-teardown.ts after tests complete.
 *
 * Credentials are saved to e2e/.auth/test-credentials.json for tests to read.
 */

import { ConvexHttpClient } from 'convex/browser';
import { api } from '../src/lib/convex/_generated/api';
import dotenv from 'dotenv';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

dotenv.config({ path: '.env.test' });

const SITE_URL = process.env.PUBLIC_SITE_URL || 'http://localhost:5173';
const TEST_PASSWORD = 'TestPassword123!';

interface TestCredentials {
	user: { email: string; password: string; name: string };
	admin: { email: string; password: string; name: string };
	anonymousSupport: { userId: string; threadId: string };
}

async function globalSetup() {
	const testSecret = process.env.AUTH_E2E_TEST_SECRET;
	const convexUrl = process.env.PUBLIC_CONVEX_URL || process.env.VITE_CONVEX_URL;

	if (!testSecret) {
		console.error('[Setup] Error: AUTH_E2E_TEST_SECRET missing from .env.test');
		console.error('[Setup] 1. Generate a secret: openssl rand -base64 32');
		console.error('[Setup] 2. Set in Convex: bunx convex env set AUTH_E2E_TEST_SECRET <value>');
		console.error('[Setup] 3. Add to .env.test: AUTH_E2E_TEST_SECRET=<value>');
		throw new Error('AUTH_E2E_TEST_SECRET not configured');
	}

	if (!convexUrl) {
		console.error('[Setup] Error: PUBLIC_CONVEX_URL missing from .env.test');
		throw new Error('PUBLIC_CONVEX_URL not configured');
	}

	const client = new ConvexHttpClient(convexUrl);
	const timestamp = Date.now();

	// Generate unique emails for this test run
	const credentials: TestCredentials = {
		user: {
			email: `test-user-${timestamp}@e2e.example.com`,
			password: TEST_PASSWORD,
			name: 'E2E Test User'
		},
		admin: {
			email: `test-admin-${timestamp}@e2e.example.com`,
			password: TEST_PASSWORD,
			name: 'E2E Test Admin'
		},
		anonymousSupport: {
			userId: '',
			threadId: ''
		}
	};

	console.log('[Setup] Creating fresh test users...');
	console.log(`[Setup]   User: ${credentials.user.email}`);
	console.log(`[Setup]   Admin: ${credentials.admin.email}`);

	// Create regular user
	await createUser(credentials.user, testSecret, client);

	// Create admin user
	await createUser(credentials.admin, testSecret, client, true);

	// Create anonymous support thread for migration tests
	const anonymousUserId = `anon_${crypto.randomUUID()}`;
	const anonymousThread = await client.mutation(api.tests.createAnonymousSupportThread, {
		secret: testSecret,
		anonymousUserId,
		title: 'E2E Support Thread',
		pageUrl: `${SITE_URL}/en/app`
	});

	credentials.anonymousSupport = {
		userId: anonymousThread.anonymousUserId,
		threadId: anonymousThread.threadId
	};

	// Save credentials for tests to read
	const authDir = path.join(process.cwd(), 'e2e', '.auth');
	if (!fs.existsSync(authDir)) {
		fs.mkdirSync(authDir, { recursive: true });
	}

	const credentialsPath = path.join(authDir, 'test-credentials.json');
	fs.writeFileSync(credentialsPath, JSON.stringify(credentials, null, 2));
	console.log(`[Setup] Credentials saved to ${credentialsPath}`);

	console.log('[Setup] Test users ready!');
}

async function createUser(
	user: { email: string; password: string; name: string },
	secret: string,
	client: ConvexHttpClient,
	isAdmin = false
) {
	const userType = isAdmin ? 'Admin' : 'Regular';

	// Sign up the user
	try {
		const signUpResponse = await fetch(`${SITE_URL}/api/auth/sign-up/email`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Origin: SITE_URL
			},
			body: JSON.stringify({
				email: user.email,
				password: user.password,
				name: user.name
			})
		});

		if (!signUpResponse.ok) {
			const errorData = await signUpResponse.json().catch(() => ({}));
			console.error(`[Setup]   Error creating ${userType} user:`, errorData);
			throw new Error(`Failed to create ${userType} test user`);
		}

		console.log(`[Setup]   ${userType} user created`);

		// Verify email (or set admin role + verify)
		if (isAdmin) {
			const result = await client.mutation(api.tests.createTestAdminUser, {
				email: user.email,
				secret
			});
			if (!result.success) {
				throw new Error(`Failed to setup admin: ${result.error}`);
			}
			console.log(`[Setup]   Admin role set and email verified`);
		} else {
			const result = await client.mutation(api.tests.verifyTestUserEmail, {
				email: user.email,
				secret
			});
			if (!result.success) {
				throw new Error(`Failed to verify email: ${result.error}`);
			}
			console.log(`[Setup]   Email verified`);
		}

		// Verify credentials work
		const signInResponse = await fetch(`${SITE_URL}/api/auth/sign-in/email`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Origin: SITE_URL
			},
			body: JSON.stringify({ email: user.email, password: user.password })
		});

		if (!signInResponse.ok) {
			const errorData = await signInResponse.json().catch(() => ({}));
			console.error(`[Setup]   Credential verification failed:`, errorData);
			throw new Error('Credential verification failed');
		}

		console.log(`[Setup]   Credentials verified`);
	} catch (error) {
		if (error instanceof Error) {
			const msg = error.message;
			if (msg.includes('ECONNREFUSED')) {
				console.error('[Setup] Error: Could not connect to the server.');
				console.error('[Setup] The dev server should be started by Playwright automatically.');
				throw new Error('Server connection failed');
			}
		}
		throw error;
	}
}

export default globalSetup;
