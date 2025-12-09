import { defineConfig, devices } from '@playwright/test';

/**
 * Read environment variables from .env.test
 */
import dotenv from 'dotenv';
dotenv.config({ path: '.env.test' });

export default defineConfig({
	testDir: 'e2e',
	/* Run tests in files in parallel */
	fullyParallel: true,
	/* Fail the build on CI if you accidentally left test.only in the source code */
	forbidOnly: !!process.env.CI,
	/* Retry on CI only */
	retries: process.env.CI ? 2 : 0,
	/* Opt out of parallel tests on CI */
	workers: process.env.CI ? 1 : undefined,
	/* Reporter to use */
	reporter: 'html',
	/* Shared settings for all the projects below */
	use: {
		/* Base URL to use in actions like `await page.goto('/')` */
		baseURL: 'http://localhost:5173',
		/* Collect trace when retrying the failed test */
		trace: 'on-first-retry'
	},

	/* Configure projects */
	projects: [
		// Setup project - authenticates and saves state
		{
			name: 'setup',
			testMatch: /.*\.setup\.ts/
		},
		// Tests that need authentication (most tests)
		{
			name: 'chromium',
			use: {
				...devices['Desktop Chrome'],
				// Use stored auth state from setup
				storageState: 'e2e/.auth/user.json'
			},
			dependencies: ['setup'],
			// Don't run invalid-auth tests - those need unauthenticated state
			testIgnore: /invalid-auth\.spec\.ts/
		},
		// Tests that specifically test unauthenticated behavior
		{
			name: 'chromium-no-auth',
			use: { ...devices['Desktop Chrome'] },
			testMatch: /invalid-auth\.spec\.ts/
		}
	],

	webServer: {
		command: 'bun run dev:frontend',
		port: 5173,
		reuseExistingServer: !process.env.CI,
		timeout: 60000
	}
});
