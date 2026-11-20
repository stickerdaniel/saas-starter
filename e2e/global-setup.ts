/**
 * Playwright Global Setup
 *
 * Waits for the backend, provisions the session signing key and opens the run's
 * ownership ledger (e2e/utils/owned-test-data.ts). It creates no accounts: each
 * authenticated worker creates its own (e2e/utils/test.ts), and global-teardown.ts
 * deletes everything the ledger lists.
 */

import { setTimeout as sleep } from 'node:timers/promises';
import 'varlock/auto-load';
import { beginOwnedTestData } from './utils/owned-test-data';
import { usesLocalTestBackend, waitForConvexUrl } from './utils/convex-url';
import { watchTestBackendExit } from '../scripts/test-backend-exit';
import { resolveSiteUrl } from './utils/site-url';
import { getPreviewBypass, fetchVercelBypassCookie } from './utils/preview-bypass';
import { waitForBackendReady } from './utils/backend-readiness';

const SITE_URL = resolveSiteUrl();
// Delays before the 2nd and 3rd attempt of an HTTP call (3 attempts total).
const HTTP_RETRY_DELAYS_MS = [2000, 5000];

/**
 * Fetch with retry on network errors and 5xx responses. A cold CF Workers
 * preview can answer the first request with a non-JSON 5xx before the
 * Better Auth handler has warmed up. A 4xx is a real failure and is returned
 * immediately without retrying.
 */
async function fetchWithRetry(url: string, init: RequestInit, label: string): Promise<Response> {
	const totalAttempts = HTTP_RETRY_DELAYS_MS.length + 1;
	for (let attempt = 1; ; attempt++) {
		let response: Response;
		try {
			response = await fetch(url, init);
		} catch (error) {
			if (attempt >= totalAttempts) throw error;
			const delayMs = HTTP_RETRY_DELAYS_MS[attempt - 1]!;
			const message = error instanceof Error ? error.message : String(error);
			console.warn(
				`[Setup]   ${label} network error on attempt ${attempt}/${totalAttempts}, retrying in ${delayMs}ms: ${message}`
			);
			await sleep(delayMs);
			continue;
		}

		if (response.status < 500 || attempt >= totalAttempts) {
			return response;
		}

		const delayMs = HTTP_RETRY_DELAYS_MS[attempt - 1]!;
		console.warn(
			`[Setup]   ${label} got HTTP ${response.status} on attempt ${attempt}/${totalAttempts}, retrying in ${delayMs}ms`
		);
		await sleep(delayMs);
	}
}

/**
 * Provisions the session signing key before the first sign-in starts parallel mints.
 * Better Auth's read-then-create can otherwise produce two keys on a fresh backend.
 * A verifier that cached JWKS between those inserts rejects the newer key until
 * the cache expires. Revalidate at the origin so an old preview's cached key set
 * cannot stand in for provisioning this backend. The request also warms the auth
 * handler, so the workers' single sign-up attempts meet a warm preview.
 */
async function provisionSessionSigningKey(): Promise<void> {
	const response = await fetchWithRetry(
		`${SITE_URL}/api/auth/convex/jwks`,
		{ headers: { ...getPreviewBypass().headers, 'cache-control': 'no-cache' } },
		'Signing key'
	);
	const body: unknown = response.ok ? await response.json().catch(() => undefined) : undefined;
	const hasKey =
		typeof body === 'object' &&
		body !== null &&
		'keys' in body &&
		Array.isArray(body.keys) &&
		body.keys.length > 0;
	if (!hasKey) {
		throw new Error(`Session signing key was not provisioned: HTTP ${response.status}`);
	}
	console.log('[Setup] Session signing key ready');
}

async function globalSetup() {
	const testSecret = process.env.AUTH_E2E_TEST_SECRET;

	if (!testSecret) {
		console.error('[Setup] Error: AUTH_E2E_TEST_SECRET missing from .env.test');
		console.error('[Setup] 1. Generate a secret: openssl rand -base64 32');
		console.error('[Setup] 2. Set in Convex: bunx convex env set AUTH_E2E_TEST_SECRET <value>');
		console.error('[Setup] 3. Add to .env.test: AUTH_E2E_TEST_SECRET=<value>');
		throw new Error('AUTH_E2E_TEST_SECRET not configured');
	}

	const convexUrl = await waitForConvexUrl();
	if (!convexUrl) {
		console.error('[Setup] Error: PUBLIC_CONVEX_URL not set and no local backend URL found');
		console.error(
			'[Setup] Either set PUBLIC_CONVEX_URL in .env.test or start the dev server first'
		);
		throw new Error('Convex URL not configured');
	}

	// Gate the first worker's sign-up on real backend readiness (not just the vite port being open).
	await waitForBackendReady(convexUrl, testSecret);

	// Resolve preview access before any worker records an intended backend write.
	await fetchVercelBypassCookie(SITE_URL);
	await provisionSessionSigningKey();
	const runId = beginOwnedTestData();
	console.log(`[Setup] Ownership ledger e2e/.auth/owned/${runId} ready`);

	if (!usesLocalTestBackend()) return;
	// SIGINT is Playwright's graceful stop: the run ends as interrupted, with its
	// reports written and both teardowns run. Emitting it reaches Playwright's
	// handler on every platform; a self-sent signal terminates Windows processes.
	return watchTestBackendExit((error) => {
		console.error(`[E2E] ${error.split('\n', 1)[0]}`);
		console.error('[E2E] Stopping the run, because every later test would fail against it.');
		process.emit('SIGINT');
	});
}

export default globalSetup;
