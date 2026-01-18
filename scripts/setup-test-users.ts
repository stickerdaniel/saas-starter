/**
 * Setup Test Users Script
 *
 * Creates test users in your Convex/Better Auth database for E2E testing:
 * - Regular user: for standard authenticated tests
 * - Admin user: for admin panel tests (created then promoted to admin role)
 *
 * Usage: bun run setup:test-users
 *
 * Prerequisites:
 * - Dev server running (bun run dev)
 * - Convex dev running (bunx convex dev)
 * - AUTH_E2E_TEST_SECRET set in Convex (bunx convex env set AUTH_E2E_TEST_SECRET <value>)
 * - AUTH_E2E_TEST_SECRET also set in .env.test file (must match Convex value)
 */

import { config } from 'dotenv';
import { execSync } from 'child_process';

// Load .env.test file
config({ path: '.env.test' });

const SITE_URL = process.env.PUBLIC_SITE_URL || 'http://localhost:5173';

type TestUserRole = 'admin' | 'user';

interface TestUserConfig {
	email: string;
	password: string;
	name: string;
	role: TestUserRole;
}

async function setupTestUsers() {
	const secret = process.env.AUTH_E2E_TEST_SECRET;

	// Validate required environment variables
	if (!secret) {
		console.error('Error: AUTH_E2E_TEST_SECRET missing from .env.test');
		console.error('');
		console.error('1. Generate a secret: openssl rand -base64 32');
		console.error('2. Set in Convex: bunx convex env set AUTH_E2E_TEST_SECRET <value>');
		console.error('3. Add to .env.test: AUTH_E2E_TEST_SECRET=<value>');
		process.exit(1);
	}

	// Define test users
	const users: TestUserConfig[] = [
		{
			email: process.env.TEST_USER_EMAIL || 'test-user@e2e.example.com',
			password: process.env.TEST_USER_PASSWORD || 'TestPassword123!',
			name: process.env.TEST_USER_NAME || 'E2E Test User',
			role: 'user'
		},
		{
			email: process.env.TEST_ADMIN_EMAIL || 'test-admin@e2e.example.com',
			password: process.env.TEST_ADMIN_PASSWORD || 'TestAdminPassword123!',
			name: process.env.TEST_ADMIN_NAME || 'E2E Test Admin',
			role: 'admin'
		}
	];

	// Validate user configs
	for (const user of users) {
		if (!user.email || !user.password) {
			console.error(`Error: Missing email or password for ${user.role} test user`);
			process.exit(1);
		}
	}

	console.log('Setting up test users...');
	console.log(`   Site URL: ${SITE_URL}`);
	console.log('');

	for (const user of users) {
		await setupSingleUser(user, secret);
	}

	console.log('');
	console.log('All test users set up successfully!');
	console.log('You can now run E2E tests with: bun run test:e2e');
}

async function setupSingleUser(user: TestUserConfig, secret: string) {
	const userType = user.role === 'admin' ? 'Admin' : 'Regular';
	console.log(`--- Setting up ${userType} Test User ---`);
	console.log(`   Email: ${user.email}`);
	console.log(`   Name: ${user.name}`);

	// Try to sign up the user
	try {
		const signUpResponse = await fetch(`${SITE_URL}/api/auth/sign-up/email`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				email: user.email,
				password: user.password,
				name: user.name
			})
		});

		if (signUpResponse.ok) {
			console.log('   User created successfully!');
		} else {
			const errorData = await signUpResponse.json().catch(() => {
				console.warn('   (Response was not JSON)');
				return {};
			});

			// Check if user already exists
			if (
				signUpResponse.status === 400 ||
				signUpResponse.status === 422 ||
				errorData.message?.includes('already exists') ||
				errorData.code === 'USER_ALREADY_EXISTS'
			) {
				console.log('   User already exists.');
			} else {
				console.error('   Error creating user:', errorData);
				process.exit(1);
			}
		}

		// For admin users, use the combined mutation that sets role AND verifies email
		if (user.role === 'admin') {
			await setupAdminUser(user.email, secret);
		} else {
			await verifyEmail(user.email, secret);
		}

		await verifyCredentials(user.email, user.password);
		console.log(`   ${userType} user ready!`);
		console.log('');
	} catch (error) {
		// Handle common network errors with actionable messages
		if (error instanceof Error) {
			const msg = error.message;
			if (msg.includes('ECONNREFUSED')) {
				console.error('Error: Could not connect to the server.');
				console.error('   Make sure your dev server is running: bun run dev');
				process.exit(1);
			}
			if (msg.includes('ENOTFOUND') || msg.includes('getaddrinfo')) {
				console.error('Error: DNS resolution failed.');
				console.error('   Check that PUBLIC_SITE_URL is correct in .env.test');
				process.exit(1);
			}
			if (msg.includes('ETIMEDOUT') || msg.includes('timeout')) {
				console.error('Error: Connection timed out.');
				console.error('   The server may be slow or unreachable.');
				process.exit(1);
			}
			if (msg.includes('CERT') || msg.includes('certificate')) {
				console.error('Error: TLS/SSL certificate issue.');
				console.error('   Try using http:// instead of https:// for local dev.');
				process.exit(1);
			}
		}
		throw error;
	}
}

async function verifyEmail(email: string, secret: string) {
	console.log('   Marking email as verified...');
	try {
		const result = execSync(
			`bunx convex run tests:verifyTestUserEmail '{"email": "${email}", "secret": "${secret}"}'`,
			{ stdio: 'pipe', encoding: 'utf-8' }
		);

		const parsed = JSON.parse(result.trim());
		if (parsed.success) {
			console.log(parsed.alreadyVerified ? '   Email was already verified' : '   Email verified!');
		} else {
			console.error('   Failed to verify email:', parsed.error);
			process.exit(1);
		}
	} catch (error) {
		// Log detailed error info from execSync (stderr/stdout)
		if (error && typeof error === 'object' && 'stderr' in error) {
			const execError = error as { stderr?: string; stdout?: string; message?: string };
			console.error('   Email verification failed');
			if (execError.stderr) console.error('   stderr:', execError.stderr.toString().trim());
			if (execError.stdout) console.error('   stdout:', execError.stdout.toString().trim());
		} else {
			const errorMessage = error instanceof Error ? error.message : String(error);
			console.error('   Email verification failed:', errorMessage);
		}
		console.error('');
		console.error('   Make sure AUTH_E2E_TEST_SECRET is set in Convex:');
		console.error('   bunx convex env set AUTH_E2E_TEST_SECRET <your-secret>');
		process.exit(1);
	}
}

async function setupAdminUser(email: string, secret: string) {
	console.log('   Setting up admin role and verifying email...');
	try {
		const result = execSync(
			`bunx convex run tests:createTestAdminUser '{"email": "${email}", "secret": "${secret}"}'`,
			{ stdio: 'pipe', encoding: 'utf-8' }
		);

		const parsed = JSON.parse(result.trim());
		if (parsed.success) {
			if (parsed.alreadyAdmin && parsed.alreadyVerified) {
				console.log('   User is already admin with verified email');
			} else {
				console.log('   Admin role set and email verified!');
			}
		} else {
			console.error('   Failed to setup admin:', parsed.error);
			process.exit(1);
		}
	} catch (error) {
		// Log detailed error info from execSync (stderr/stdout)
		if (error && typeof error === 'object' && 'stderr' in error) {
			const execError = error as { stderr?: string; stdout?: string; message?: string };
			console.error('   Admin setup failed');
			if (execError.stderr) console.error('   stderr:', execError.stderr.toString().trim());
			if (execError.stdout) console.error('   stdout:', execError.stdout.toString().trim());
		} else {
			const errorMessage = error instanceof Error ? error.message : String(error);
			console.error('   Admin setup failed:', errorMessage);
		}
		process.exit(1);
	}
}

async function verifyCredentials(email: string, password: string) {
	console.log('   Verifying credentials...');
	const signInResponse = await fetch(`${SITE_URL}/api/auth/sign-in/email`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ email, password })
	});

	if (signInResponse.ok) {
		console.log('   Credentials verified!');
	} else {
		const errorData = await signInResponse.json().catch(() => {
			console.warn('   (Response was not JSON)');
			return {};
		});
		console.error('   Error: Could not sign in with test credentials.');
		console.error('   Response:', errorData);
		console.error('');
		console.error('   If the password is wrong, delete the user from Convex dashboard');
		console.error('   and run this script again.');
		process.exit(1);
	}
}

setupTestUsers().catch((error) => {
	console.error('Unexpected error:', error);
	process.exit(1);
});
