import { ConvexHttpClient } from 'convex/browser';
import { setTimeout as sleep } from 'node:timers/promises';
import { api } from '../../src/lib/convex/_generated/api';

const DEFAULT_TIMEOUT_MS = 90_000;
const DEFAULT_POLL_INTERVAL_MS = 1000;

export interface BackendReadinessOptions {
	/** Total budget for all attempts. Only tests override the default. */
	timeoutMs?: number;
	/** Pause between two health checks. Only tests override the default. */
	pollIntervalMs?: number;
}

/**
 * Wait until the Convex backend reports ready via api.tests.health.
 *
 * The convex-vite-plugin starts backend deploy asynchronously after vite begins
 * serving (node_modules/convex-vite-plugin/src/index.ts:302), so Playwright's
 * webServer port-check on the test vite port (derived per project, see
 * scripts/dev-ports.ts) succeeds well before Convex is reachable. Without
 * this gate, the first signup HTTP call can hit a 500 from a not-yet-ready
 * backend and globalSetup's existing retry only covers transient network errors.
 *
 * The probe also doubles as a propagation check: if AUTH_E2E_TEST_SECRET didn't
 * reach the backend (vite.config.ts envVars wiring), the call returns
 * Unauthorized and we fail fast with a clear error.
 *
 * The time budget is binding: ConvexHttpClient.query has no deadline of its
 * own, so everything here relies on an AbortController triggered by a single
 * overall timer. A backend that accepts the connection and then stays silent
 * would otherwise let the call wait past the deadline because it was only
 * checked after the query.
 */
export async function waitForBackendReady(
	convexUrl: string,
	secret: string,
	options: BackendReadinessOptions = {}
): Promise<void> {
	const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
	const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;

	const controller = new AbortController();
	const deadlineTimer = setTimeout(() => controller.abort(), timeoutMs);

	// Dedicated client for the readiness loop: its transport uses the signal,
	// while the caller's regular setup client remains unaffected and survives
	// the abort.
	const client = new ConvexHttpClient(convexUrl, {
		fetch: (input, init) => fetch(input, { ...init, signal: controller.signal })
	});

	const start = Date.now();
	// The timer alone is not enough: if the budget expires between two ticks,
	// neither another query may start nor may a late response count as success.
	const pastDeadline = () => controller.signal.aborted || Date.now() - start >= timeoutMs;

	let lastError: unknown;
	console.log('[Setup] Waiting for Convex backend readiness (api.tests.health)...');

	try {
		while (!pastDeadline()) {
			try {
				const r = await client.query(api.tests.health, { secret });
				if (pastDeadline()) break;
				if (r?.ok) {
					console.log(`[Setup] Backend ready after ${Date.now() - start}ms`);
					return;
				}
			} catch (err) {
				// An abort means the deadline expired, not that the backend failed.
				if (pastDeadline()) break;

				// Distinguish auth failure (config bug, fail fast) from cold-boot/network errors (retry).
				// A backend that returns "Unauthorized" is already serving — polling won't fix it.
				const message = err instanceof Error ? err.message : String(err);
				if (message.includes('Unauthorized: Invalid test secret')) {
					throw new Error(
						'Test backend rejected AUTH_E2E_TEST_SECRET. The secret in .env.test does not ' +
							'match what the backend received from vite.config.ts envVars. Check that ' +
							'`bun run dev:test` is running and that AUTH_E2E_TEST_SECRET is set in .env.test.',
						{ cause: err }
					);
				}
				lastError = err;
			}

			try {
				// The pause uses the same signal so the timer ends it instead of leaving
				// behind an unobserved loser in a promise race.
				await sleep(pollIntervalMs, undefined, { signal: controller.signal });
			} catch {
				break;
			}
		}

		console.error('[Setup] Last error from health probe:', lastError);
		throw new Error(`Test backend never reported ready (api.tests.health) within ${timeoutMs}ms`);
	} finally {
		clearTimeout(deadlineTimer);
		// End any request still in flight along with its open response body, even
		// when the loop exits through the authentication error path.
		controller.abort();
	}
}
