import fs from 'fs';
import path from 'path';

/**
 * Resolve the Convex backend URL.
 *
 * Local test mode (VARLOCK_ENV=test, no CI):
 *   1. `.convex/.test-backend-url` (written by `bun run dev:test`)
 *   2. `PUBLIC_CONVEX_URL` / `VITE_CONVEX_URL` env (fallback)
 *   3. `.convex/.backend-url` (dev backend, last-resort fallback)
 *
 *   The file deliberately wins over env in local test mode so a stale cloud URL in
 *   a developer's gitignored `.env.test` can't silently route "local" e2e at cloud
 *   Convex while other plumbing points at the local stack.
 *
 * Everything else (CI, cloud, ad-hoc):
 *   1. `PUBLIC_CONVEX_URL` / `VITE_CONVEX_URL` env (set by CI workflows)
 *   2. `.convex/.backend-url` file written by vite.config.ts
 */
export function resolveConvexUrl(): string | undefined {
	// E2E_OVERRIDE_SITE_URL signals the caller is targeting a developer-managed deployment;
	// in that mode we want PUBLIC_CONVEX_URL (set alongside the override) to win, NOT a
	// stale local .test-backend-url file from a previous dev:test run.
	const isLocalTest =
		process.env.VARLOCK_ENV === 'test' && !process.env.CI && !process.env.E2E_OVERRIDE_SITE_URL;
	const testBackendFile = path.join(process.cwd(), '.convex', '.test-backend-url');
	const devBackendFile = path.join(process.cwd(), '.convex', '.backend-url');

	if (isLocalTest && fs.existsSync(testBackendFile)) {
		const url = fs.readFileSync(testBackendFile, 'utf-8').trim();
		if (url) {
			console.log(`[E2E] Using isolated local test backend: ${url}`);
			return url;
		}
	}

	const envUrl = process.env.PUBLIC_CONVEX_URL || process.env.VITE_CONVEX_URL;
	if (envUrl) return envUrl;

	if (fs.existsSync(devBackendFile)) {
		const url = fs.readFileSync(devBackendFile, 'utf-8').trim();
		if (url) {
			console.log(`[E2E] Using local Convex backend: ${url}`);
			return url;
		}
	}

	return undefined;
}
