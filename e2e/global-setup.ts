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
import 'varlock/auto-load';
import fs from 'fs';
import path from 'path';

const SITE_URL = process.env.PUBLIC_SITE_URL || 'http://localhost:5173';
const TEST_PASSWORD = 'TestPassword123!';
const SETUP_RETRY_ATTEMPTS = 3;

import type { TestCredentials } from './utils/types';
import { resolveConvexUrl } from './utils/convex-url';
import { getPreviewBypass, fetchVercelBypassCookie } from './utils/preview-bypass';

function isTransientSetupError(error: unknown): boolean {
	if (!(error instanceof Error)) return false;

	const details = [error.message, error.cause instanceof Error ? error.cause.message : '']
		.join(' ')
		.toLowerCase();

	return (
		details.includes('fetch failed') ||
		details.includes('connect timeout') ||
		details.includes('connection refused') ||
		details.includes('econnreset') ||
		details.includes('etimedout')
	);
}

async function retrySetupStep<T>(label: string, run: () => Promise<T>): Promise<T> {
	for (let attempt = 1; attempt <= SETUP_RETRY_ATTEMPTS; attempt++) {
		try {
			return await run();
		} catch (error) {
			if (!isTransientSetupError(error) || attempt === SETUP_RETRY_ATTEMPTS) {
				throw error;
			}

			const delayMs = attempt * 1000;
			console.warn(
				`[Setup]   ${label} failed on attempt ${attempt}/${SETUP_RETRY_ATTEMPTS}, retrying in ${delayMs}ms`
			);
			await new Promise((resolve) => setTimeout(resolve, delayMs));
		}
	}

	throw new Error(`[Setup] Unexpected retry fallthrough for ${label}`);
}

async function globalSetup() {
	const testSecret = process.env.AUTH_E2E_TEST_SECRET;
	const convexUrl = resolveConvexUrl();

	if (!testSecret) {
		console.error('[Setup] Error: AUTH_E2E_TEST_SECRET missing from .env.test');
		console.error('[Setup] 1. Generate a secret: openssl rand -base64 32');
		console.error('[Setup] 2. Set in Convex: bunx convex env set AUTH_E2E_TEST_SECRET <value>');
		console.error('[Setup] 3. Add to .env.test: AUTH_E2E_TEST_SECRET=<value>');
		throw new Error('AUTH_E2E_TEST_SECRET not configured');
	}

	if (!convexUrl) {
		console.error('[Setup] Error: PUBLIC_CONVEX_URL not set and no local backend URL found');
		console.error(
			'[Setup] Either set PUBLIC_CONVEX_URL in .env.test or start the dev server first'
		);
		throw new Error('Convex URL not configured');
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
			threadIds: []
		}
	};

	// For protected preview deployments, fetch bypass cookie if applicable
	await fetchVercelBypassCookie(SITE_URL);

	console.log('[Setup] Creating fresh test users...');
	console.log(`[Setup]   User: ${credentials.user.email}`);
	console.log(`[Setup]   Admin: ${credentials.admin.email}`);

	// Create regular user
	await createUser(credentials.user, testSecret, client);

	// Create admin user
	await createUser(credentials.admin, testSecret, client, true);

	// Anonymous support threads are created per-test for retry safety
	// (Each test attempt creates fresh threads to avoid state pollution)
	credentials.anonymousSupport = {
		userId: '',
		threadIds: []
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
	const bypass = getPreviewBypass();

	const getHeaders = (): Record<string, string> => ({
		'Content-Type': 'application/json',
		Origin: SITE_URL,
		...bypass.headers
	});

	// Sign up the user
	try {
		const signUpResponse = await fetch(`${SITE_URL}/api/auth/sign-up/email`, {
			method: 'POST',
			headers: getHeaders(),
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
			const result = await retrySetupStep('createTestAdminUser', () =>
				client.mutation(api.tests.createTestAdminUser, {
					email: user.email,
					secret
				})
			);
			if (!result.success) {
				throw new Error(`Failed to setup admin: ${result.error}`);
			}
			console.log(`[Setup]   Admin role set and email verified`);
		} else {
			const result = await retrySetupStep('verifyTestUserEmail', () =>
				client.mutation(api.tests.verifyTestUserEmail, {
					email: user.email,
					secret
				})
			);
			if (!result.success) {
				throw new Error(`Failed to verify email: ${result.error}`);
			}
			console.log(`[Setup]   Email verified`);
		}

		// Verify credentials work
		const signInResponse = await fetch(`${SITE_URL}/api/auth/sign-in/email`, {
			method: 'POST',
			headers: getHeaders(),
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
