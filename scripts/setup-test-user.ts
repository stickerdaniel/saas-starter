/**
 * Setup Test User Script
 *
 * Creates a test user in your Convex/Better Auth database for E2E testing.
 * Run this once after setting up your Convex project.
 *
 * Usage: bun run setup:test-user
 *
 * Prerequisites:
 * - Dev server running (bun run dev)
 * - Convex dev running (bunx convex dev)
 */

import { config } from 'dotenv';
import { execSync } from 'child_process';

// Load .env.test file
config({ path: '.env.test' });

const SITE_URL = process.env.PUBLIC_SITE_URL || 'http://localhost:5173';

async function setupTestUser() {
	const email = process.env.TEST_USER_EMAIL;
	const password = process.env.TEST_USER_PASSWORD;
	const name = process.env.TEST_USER_NAME || 'E2E Test User';

	if (!email || !password) {
		console.error('Error: TEST_USER_EMAIL and TEST_USER_PASSWORD must be set.');
		console.error('');
		console.error('1. Update .env.test with your test credentials');
		console.error('2. Run this script again');
		process.exit(1);
	}

	console.log('Setting up test user...');
	console.log(`   Email: ${email}`);
	console.log(`   Name: ${name}`);
	console.log(`   Site URL: ${SITE_URL}`);
	console.log('');

	// Try to sign up the user
	try {
		const signUpResponse = await fetch(`${SITE_URL}/api/auth/sign-up/email`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({
				email,
				password,
				name
			})
		});

		if (signUpResponse.ok) {
			console.log('Test user created successfully!');
			await verifyEmail(email);
			await verifyCredentials(email, password);
			return;
		}

		const errorData = await signUpResponse.json().catch(() => ({}));

		// Check if user already exists
		if (
			signUpResponse.status === 400 ||
			signUpResponse.status === 422 ||
			errorData.message?.includes('already exists') ||
			errorData.code === 'USER_ALREADY_EXISTS'
		) {
			console.log('Test user already exists. Verifying credentials...');
			await verifyEmail(email);
			await verifyCredentials(email, password);
			return;
		}

		console.error('Error creating test user:', errorData);
		process.exit(1);
	} catch (error) {
		if (error instanceof Error && error.message.includes('ECONNREFUSED')) {
			console.error('Error: Could not connect to the server.');
			console.error('   Make sure your dev server is running: bun run dev');
			process.exit(1);
		}
		throw error;
	}
}

async function verifyEmail(email: string) {
	console.log('Marking email as verified...');
	try {
		// Directly mark the user's email as verified via Convex mutation
		const result = execSync(`bunx convex run tests:verifyTestUserEmail '{"email": "${email}"}'`, {
			stdio: 'pipe',
			encoding: 'utf-8'
		});

		const parsed = JSON.parse(result.trim());
		if (parsed.success) {
			if (parsed.alreadyVerified) {
				console.log('Email was already verified');
			} else {
				console.log('Email verified successfully!');
			}
		} else {
			console.error('Failed to verify email:', parsed.error);
		}
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error);
		console.error('Email verification failed:', errorMessage);
		// Don't throw - try to continue anyway
	}
}

async function verifyCredentials(email: string, password: string) {
	console.log('Verifying credentials work...');
	const signInResponse = await fetch(`${SITE_URL}/api/auth/sign-in/email`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json'
		},
		body: JSON.stringify({
			email,
			password
		})
	});

	if (signInResponse.ok) {
		console.log('Test user credentials verified!');
		console.log('');
		console.log('Setup complete! You can now run E2E tests with:');
		console.log('   bun run test:e2e');
	} else {
		const errorData = await signInResponse.json().catch(() => ({}));
		console.error('Error: Could not sign in with test credentials.');
		console.error('   Response:', errorData);
		console.error('');
		console.error('   If the password is wrong, delete the user from Convex dashboard');
		console.error('   and run this script again.');
		process.exit(1);
	}
}

setupTestUser().catch((error) => {
	console.error('Unexpected error:', error);
	process.exit(1);
});
