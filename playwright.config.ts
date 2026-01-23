import { defineConfig, devices } from '@playwright/test';

/**
 * Read environment variables from .env.test
 */
import dotenv from 'dotenv';
dotenv.config({ path: '.env.test' });

// In CI, tests run against actual Vercel preview deployment (PUBLIC_SITE_URL set by workflow)
// Locally, tests run against dev server on localhost
const baseURL = process.env.PUBLIC_SITE_URL || 'http://localhost:5173';
const isCI = !!process.env.CI;

// Vercel automation bypass for protected preview deployments
const vercelBypassSecret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;

export default defineConfig({
	testDir: 'e2e',
	/* Ensure test users exist before running tests */
	globalSetup: './e2e/global-setup.ts',
	/* Clean up test data after all tests complete */
	globalTeardown: './e2e/global-teardown.ts',
	/* Run tests in files in parallel */
	fullyParallel: true,
	/* Fail the build on CI if you accidentally left test.only in the source code */
	forbidOnly: isCI,
	/* Retry on CI only */
	retries: isCI ? 2 : 0,
	/* Opt out of parallel tests on CI */
	workers: isCI ? 1 : undefined,
	/* Reporter to use */
	reporter: 'html',
	/* Shared settings for all the projects below */
	use: {
		/* Base URL to use in actions like `await page.goto('/')` */
		baseURL,
		/* Collect trace when retrying the failed test */
		trace: 'on-first-retry',
		/* Vercel automation bypass header for protected preview deployments */
		...(vercelBypassSecret && {
			extraHTTPHeaders: {
				'x-vercel-protection-bypass': vercelBypassSecret,
				'x-vercel-set-bypass-cookie': 'samesitenone'
			}
		})
	},

	/* Configure projects */
	projects: [
		// Setup project - authenticates regular user and saves state
		{
			name: 'setup',
			testMatch: /signin\.setup\.ts/
		},
		// Admin setup - authenticates admin user and saves admin auth state
		{
			name: 'admin-setup',
			testMatch: /admin\.setup\.ts/
		},
		// Tests that need regular user authentication
		{
			name: 'chromium',
			use: {
				...devices['Desktop Chrome'],
				// Use stored auth state from setup
				storageState: 'e2e/.auth/user.json'
			},
			dependencies: ['setup'],
			// Don't run invalid-auth or admin tests
			testIgnore: [/invalid-auth\.spec\.ts/, /admin-.*\.spec\.ts/]
		},
		// Admin tests - require admin role
		{
			name: 'chromium-admin',
			use: {
				...devices['Desktop Chrome'],
				// Use stored admin auth state
				storageState: 'e2e/.auth/admin.json'
			},
			dependencies: ['admin-setup'],
			testMatch: /admin-.*\.spec\.ts/
		},
		// Tests that specifically test unauthenticated behavior
		{
			name: 'chromium-no-auth',
			use: { ...devices['Desktop Chrome'] },
			testMatch: /invalid-auth\.spec\.ts/
		}
	],

	// Only start local dev server when not in CI
	// In CI, we test against the actual Vercel preview deployment
	webServer: isCI
		? undefined
		: {
				command: 'bun run dev:frontend',
				port: 5173,
				reuseExistingServer: true,
				timeout: 60000
			}
});
