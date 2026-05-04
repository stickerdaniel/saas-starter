import { defineConfig, devices } from '@playwright/test';

/**
 * Load environment variables via Varlock schema
 * VARLOCK_ENV=test is set by the test:e2e script to load .env.test
 */
import 'varlock/auto-load';
import { getPreviewBypass } from './e2e/utils/preview-bypass';
import { resolveSiteUrl } from './e2e/utils/site-url';

// CI: tests run against actual preview deployment (PUBLIC_SITE_URL set by workflow).
// Local: forced to http://localhost:5174 (the test vite port spawned by `bun run dev:test`).
// See e2e/utils/site-url.ts for why PUBLIC_SITE_URL is deliberately ignored locally.
const baseURL = resolveSiteUrl();
const isCI = !!process.env.CI;

// Preview bypass headers for protected preview deployments (Vercel or Cloudflare Access)
const bypass = getPreviewBypass();

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
	/* CI: auto-detect workers based on CPU cores; locally: single worker prevents dev server overload in headed mode */
	workers: isCI ? undefined : 1,
	/* Reporter to use - auto-open after tests complete */
	reporter: [['html', { open: 'always' }]],
	/* Shared settings for all the projects below */
	use: {
		/* Base URL to use in actions like `await page.goto('/')` */
		baseURL,
		/* Collect trace when retrying the failed test */
		trace: 'on-first-retry',
		/* Preview bypass headers for protected deployments */
		...(Object.keys(bypass.headers).length > 0 && {
			extraHTTPHeaders: bypass.headers
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
			// Don't run invalid-auth, admin, or signout tests (signout runs last in its own project)
			testIgnore: [
				/invalid-auth\.spec\.ts/,
				/admin-.*\.spec\.ts/,
				/signout\.spec\.ts/,
				/public-.*\.spec\.ts/
			]
		},
		{
			name: 'chromium-public',
			use: { ...devices['Desktop Chrome'] },
			testMatch: /public-.*\.spec\.ts/
		},
		// Signout test - runs LAST to avoid invalidating session for other tests
		// The signout test logs out on the server, which would break subsequent tests
		// that reuse the same session token from user.json
		{
			name: 'chromium-signout',
			use: {
				...devices['Desktop Chrome'],
				storageState: 'e2e/.auth/user.json'
			},
			dependencies: ['chromium'], // Runs after all chromium tests
			testMatch: /signout\.spec\.ts/
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

	// Local: spawn an isolated dev:test stack (separate vite port + Convex backend +
	// state dir). reuseExistingServer is false so we never inherit a backend whose
	// state we don't own. Cold backend boot can take ~60s, hence 90s timeout.
	// CI: test against the actual preview deployment (no local server).
	webServer: isCI
		? undefined
		: {
				command: 'bun run dev:test',
				port: 5174,
				reuseExistingServer: false,
				timeout: 90000
			}
});
