import { resolveTestPort } from '../../scripts/dev-ports';

/**
 * Single source of truth for the local test stack's vite port.
 * Computed per-project (per cwd) by scripts/dev-ports.ts so parallel
 * projects/worktrees never collide; override with the TEST_VITE_PORT env var.
 * Imported by scripts/dev-test.ts (where vite is spawned), playwright.config.ts
 * (webServer + baseURL), and resolveSiteUrl below. Don't hardcode the port elsewhere.
 */
export const TEST_VITE_PORT = resolveTestPort();
const TEST_BASE_URL = `http://localhost:${TEST_VITE_PORT}`;

/**
 * Resolve the site URL e2e tests should hit.
 *
 * Order:
 *   1. `E2E_OVERRIDE_SITE_URL` — escape hatch for running the suite against a
 *      developer-managed deployment (CF preview, staging, custom convex). SKIPS the
 *      local dev:test stack entirely; pair with `PUBLIC_CONVEX_URL` for the matching backend.
 *   2. `PORTLESS_SITE_URL` — front the LOCAL stack with a vercel-labs/portless named
 *      `.localhost` URL. The local Convex stack still runs; the dev:test wrapper yields
 *      port control to portless. Becomes the baseURL and the setup Origin header, and
 *      vite.config.ts forwards it as SITE_URL/trustedOrigin so the origins match.
 *   3. Local test mode (no CI): the computed per-project test port. Deliberately ignores
 *      `PUBLIC_SITE_URL` so a stale gitignored .env.test can't asymmetrically misroute
 *      signups while the Convex resolver points at the local backend.
 *   4. CI: workflow injects the real preview URL via `PUBLIC_SITE_URL`.
 */
export function resolveSiteUrl(): string {
	if (process.env.E2E_OVERRIDE_SITE_URL) return process.env.E2E_OVERRIDE_SITE_URL;
	if (process.env.PORTLESS_SITE_URL) return process.env.PORTLESS_SITE_URL;
	if (!process.env.CI) return TEST_BASE_URL;
	return process.env.PUBLIC_SITE_URL || 'http://localhost:5173';
}
