import {
	defineConfig,
	devices,
	type PlaywrightTestOptions,
	type PlaywrightWorkerOptions,
	type Project
} from '@playwright/test';

/**
 * Load environment variables via Varlock schema
 * VARLOCK_ENV=test is set by the test:e2e script to load .env.test
 */
import 'varlock/auto-load';
import { getPreviewBypass } from './e2e/utils/preview-bypass';
import { resolveSiteUrl, TEST_VITE_PORT } from './e2e/utils/site-url';
import type { WorkerAccountOptions } from './e2e/utils/test';
import { portlessOwnsPort } from './scripts/dev-ports';

// CI: tests run against actual preview deployment (PUBLIC_SITE_URL set by workflow).
// Local default: forced to the test vite port spawned by `bun run dev:test`.
// E2E_OVERRIDE_SITE_URL: explicit escape hatch — point tests at a developer-managed
// deployment (CF preview, staging, etc.) and skip the local dev:test webServer.
// See e2e/utils/site-url.ts for why PUBLIC_SITE_URL is deliberately ignored locally.
const baseURL = resolveSiteUrl();
const isCI = !!process.env.CI;
const lane = process.env.E2E_LANE || 'full';
if (!['full', 'public', 'exclusive'].includes(lane))
	throw new Error('E2E_LANE must be full, public or exclusive');
if (
	lane !== 'public' &&
	process.argv.some((arg) => arg === '--shard' || arg.startsWith('--shard='))
) {
	throw new Error(
		'Native sharding requires E2E_LANE=public; backend-mutating tests must stay exclusive'
	);
}
if (
	process.argv.some(
		(arg) => arg === '--workers' || arg === '-j' || /^(--workers=|-j[0-9])/.test(arg)
	)
) {
	throw new Error('Worker overrides are unsafe for the shared E2E backend');
}
const hasOverrideUrl = !!process.env.E2E_OVERRIDE_SITE_URL;

// Preview bypass headers for protected preview deployments (Vercel or Cloudflare Access)
const bypass = getPreviewBypass();

// A spec that reads data other specs write without an owner filter belongs here:
// the unfiltered audit log, the users table with its global counts, the
// global recipient list, and the deployment-wide OAuth registration limit.
// These run in chromium-serial after every writing project has finished, and
// no other project lists them.
const serialSpecs = [
	'**/admin-audit-log.spec.ts',
	'**/admin-users-table.spec.ts',
	'**/admin-settings.spec.ts',
	'**/admin-settings-table.spec.ts',
	'**/oauth-authorization.spec.ts',
	'**/oauth-connections.spec.ts'
];
type E2EProject = Project<PlaywrightTestOptions, PlaywrightWorkerOptions & WorkerAccountOptions>;

export default defineConfig<object, WorkerAccountOptions>({
	testDir: 'e2e',
	/* Wait for the backend and open the run's ownership ledger */
	globalSetup: lane === 'public' ? undefined : './e2e/global-setup.ts',
	/* Clean up test data after all tests complete */
	globalTeardown: lane === 'public' ? undefined : './e2e/global-teardown.ts',
	/* Run tests in files in parallel */
	fullyParallel: true,
	/* Fail the build on CI if you accidentally left test.only in the source code */
	forbidOnly: isCI,
	/* Retry on CI only */
	retries: isCI ? 2 : 0,
	/* Four workers on CI share one preview Convex backend: each signs in with
	 * accounts of its own (e2e/utils/test.ts), and the specs that read other
	 * specs' rows without an owner filter run in chromium-serial after every
	 * writer. The local dev:test stack keeps one worker. */
	workers: isCI ? 4 : 1,
	/* CI runs against an ephemeral CF preview whose cold start + Convex WebSocket
	 * boot can make a page take >10s to hydrate. Give each test generous headroom
	 * so a slow-but-functional preview does not cascade into auth-setup timeouts. */
	timeout: isCI ? 90_000 : 30_000,
	expect: { timeout: isCI ? 15_000 : 5_000 },
	/* Reporter to use - auto-open after tests complete */
	reporter: [['html', { open: 'always' }]],
	/* Shared settings for all the projects below */
	use: {
		/* Base URL to use in actions like `await page.goto('/')` */
		baseURL,
		/* Collect trace when retrying the failed test */
		trace: 'on-first-retry',
		/* Preview bypass headers for protected deployments. */
		extraHTTPHeaders: bypass.headers
	},

	/* Configure projects */
	projects: (
		[
			// Tests that need regular user authentication. Every context starts signed
			// in as the worker's own user (e2e/utils/test.ts).
			{
				name: 'chromium',
				use: { ...devices['Desktop Chrome'], signedInAs: 'user' },
				// Public, admin and signout tests have their own authentication requirements.
				testIgnore: [
					'**/unauthenticated-redirect.spec.ts',
					'**/admin-*.spec.ts',
					'**/signout.spec.ts',
					'**/public-*.spec.ts',
					...serialSpecs
				]
			},
			{
				name: 'chromium-public',
				use: { ...devices['Desktop Chrome'] },
				testMatch: '**/public-*.spec.ts'
			},
			// Signout test - signs in to an account of its own, so its logout ends no
			// worker session and every retry starts signed in
			{
				name: 'chromium-signout',
				use: { ...devices['Desktop Chrome'] },
				// Depending on chromium would replay that entire project for targeted
				// signout runs and place it outside Playwright's shard selection.
				testMatch: '**/signout.spec.ts'
			},
			// Admin tests - every context starts signed in as the worker's own admin
			{
				name: 'chromium-admin',
				use: { ...devices['Desktop Chrome'], signedInAs: 'admin' },
				testMatch: '**/admin-*.spec.ts',
				testIgnore: serialSpecs
			},
			// Tests that specifically test unauthenticated behavior
			{
				name: 'chromium-no-auth',
				use: { ...devices['Desktop Chrome'] },
				testMatch: '**/unauthenticated-redirect.spec.ts'
			},
			// Global readers. The dependencies start this project only after every
			// writing project has finished; project-level `workers` alone would only
			// cap concurrency inside this project, not order it after the others.
			{
				name: 'chromium-serial',
				use: { ...devices['Desktop Chrome'], signedInAs: 'admin' },
				testMatch: serialSpecs,
				workers: 1,
				dependencies: ['chromium', 'chromium-admin', 'chromium-signout']
			}
		] satisfies E2EProject[]
	).filter(
		(project) =>
			lane === 'full' ||
			(lane === 'public' ? project.name === 'chromium-public' : project.name !== 'chromium-public')
	),

	// Local default: spawn an isolated dev:test stack (separate vite port + Convex backend
	// + state dir). reuseExistingServer is false so we never inherit a backend whose state
	// we don't own. Cold backend boot can take ~60s, hence 90s timeout.
	// CI or E2E_OVERRIDE_SITE_URL: skip — caller manages the deployment under test.
	webServer:
		isCI || hasOverrideUrl
			? undefined
			: {
					command: 'bun run dev:test',
					// When portless fronts vite, poll the named URL (vite sits behind portless
					// on an internal port); otherwise poll the computed per-project test port.
					...(portlessOwnsPort() ? { url: baseURL } : { port: TEST_VITE_PORT }),
					reuseExistingServer: false,
					timeout: 90000
				}
});
