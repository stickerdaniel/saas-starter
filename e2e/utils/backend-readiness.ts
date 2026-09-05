import { ConvexHttpClient } from 'convex/browser';
import { setTimeout as sleep } from 'node:timers/promises';
import { api } from '../../src/lib/convex/_generated/api';

const DEFAULT_TIMEOUT_MS = 90_000;
const DEFAULT_POLL_INTERVAL_MS = 1000;

export interface BackendReadinessOptions {
	/** Gesamtbudget für alle Versuche. Nur Tests weichen vom Default ab. */
	timeoutMs?: number;
	/** Pause zwischen zwei Health-Abfragen. Nur Tests weichen vom Default ab. */
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
 * Das Zeitbudget ist verbindlich: ConvexHttpClient.query kennt selbst keine
 * Frist, also hängt hier alles an einem AbortController, den ein Gesamttimer
 * auslöst. Ein Backend, das die Verbindung annimmt und dann schweigt, ließ den
 * Aufruf sonst über die Frist hinaus warten, weil sie erst nach der Abfrage
 * geprüft wurde.
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

	// Eigener Client nur für die Readiness-Schleife: sein Transport hängt am
	// Signal, der reguläre Setup-Client des Aufrufers bleibt davon unberührt und
	// überlebt den Abbruch.
	const client = new ConvexHttpClient(convexUrl, {
		fetch: (input, init) => fetch(input, { ...init, signal: controller.signal })
	});

	const start = Date.now();
	// Der Timer allein genügt nicht: läuft das Budget zwischen zwei Ticks ab,
	// dürfen weder eine weitere Abfrage starten noch eine späte Antwort als
	// Erfolg zählen.
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
				// Ein Abbruch ist die abgelaufene Frist, kein Backend-Fehler.
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
				// Die Pause hängt am selben Signal, damit der Timer sie beendet, statt
				// einen unbeobachteten Verlierer eines Promise-Rennens zu hinterlassen.
				await sleep(pollIntervalMs, undefined, { signal: controller.signal });
			} catch {
				break;
			}
		}

		console.error('[Setup] Last error from health probe:', lastError);
		throw new Error(`Test backend never reported ready (api.tests.health) within ${timeoutMs}ms`);
	} finally {
		clearTimeout(deadlineTimer);
		// Beendet einen noch laufenden Request samt offenem Antwortbody, auch wenn
		// die Schleife über den Auth-Fehlerpfad verlassen wird.
		controller.abort();
	}
}
