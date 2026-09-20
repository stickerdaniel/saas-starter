import fs from 'fs';
import path from 'path';
import { setTimeout as sleep } from 'node:timers/promises';

const DEFAULT_PUBLICATION_TIMEOUT_MS = 90_000;
const DEFAULT_POLL_INTERVAL_MS = 100;

export interface ConvexUrlPublicationOptions {
	timeoutMs?: number;
	pollIntervalMs?: number;
	resolve?: () => string | undefined;
	resolveLocalTest?: () => string | undefined;
}

function testBackendUrlFile(cwd = process.cwd()): string {
	return path.join(cwd, '.convex', '.test-backend-url');
}

export function invalidateLocalTestBackendUrl(cwd = process.cwd()): void {
	fs.rmSync(testBackendUrlFile(cwd), { force: true });
}

function resolveLocalTestConvexUrl(): string | undefined {
	const file = testBackendUrlFile();
	if (!fs.existsSync(file)) return undefined;

	const url = fs.readFileSync(file, 'utf-8').trim();
	if (!url) return undefined;

	console.log(`[E2E] Using isolated local test backend: ${url}`);
	return url;
}

function usesLocalTestBackend(): boolean {
	return (
		process.env.VARLOCK_ENV === 'test' && !process.env.CI && !process.env.E2E_OVERRIDE_SITE_URL
	);
}

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
	const isLocalTest = usesLocalTestBackend();
	const devBackendFile = path.join(process.cwd(), '.convex', '.backend-url');

	if (isLocalTest) {
		const url = resolveLocalTestConvexUrl();
		if (url) return url;
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

/** Wait for `bun run dev:test` to publish the backend selected by Vite. */
export async function waitForConvexUrl(
	options: ConvexUrlPublicationOptions = {}
): Promise<string | undefined> {
	if (!usesLocalTestBackend()) return (options.resolve ?? resolveConvexUrl)();

	const resolve = options.resolveLocalTest ?? resolveLocalTestConvexUrl;
	let convexUrl = resolve();
	if (convexUrl) return convexUrl;

	const timeoutMs = options.timeoutMs ?? DEFAULT_PUBLICATION_TIMEOUT_MS;
	const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
	const started = Date.now();

	console.log('[Setup] Waiting for local Convex backend URL publication...');
	while (Date.now() - started < timeoutMs) {
		const remainingMs = timeoutMs - (Date.now() - started);
		await sleep(Math.min(Math.max(1, pollIntervalMs), remainingMs));
		convexUrl = resolve();
		if (convexUrl) return convexUrl;
	}

	throw new Error(
		`Local test backend URL was not published within ${timeoutMs}ms. ` +
			'Check that `bun run dev:test` started successfully.'
	);
}
