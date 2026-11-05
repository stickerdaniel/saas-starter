import { ConvexError } from 'convex/values';
import { dev } from '$app/env';
import { loadedSentry } from '#lib/monitoring/sentry.js';
import { logSafeDiagnostic, type SafeDiagnosticFields } from '#lib/monitoring/safe-diagnostic.js';
import { getConvexErrorCode } from '#lib/utils/convex-errors.js';

// Refusals the backend sends on purpose: no or a stale session, a missing or a
// forbidden document. A load that falls back from one works as designed.
const REFUSAL_CODES = new Set(['UNAUTHENTICATED', 'NOT_FOUND', 'FORBIDDEN']);

function refusalCode(error: unknown): string | undefined {
	try {
		if (!(error instanceof ConvexError)) return undefined;
		// Better Auth's `getAuthUser` throws a bare string with no code.
		if (error.data === 'Unauthenticated') return 'UNAUTHENTICATED';
		const code = getConvexErrorCode(error);
		return code !== undefined && REFUSAL_CODES.has(code) ? code : undefined;
	} catch {
		// An error that cannot be inspected is no refusal the backend sent.
		return undefined;
	}
}

/**
 * Report a server failure the caller caught and recovered from, for example by
 * returning fallback data. A failure the caller rethrows needs no call here:
 * `handleError` reports it.
 *
 * Outside dev, the console gets one line of fixed fields, because the error's
 * message, its cause and the request path can carry user input. Sentry, once
 * loaded, gets the full error, except for a backend refusal, which logs a
 * warning with its code instead. Never throws, so the fallback stays intact.
 */
export function reportRecoveredFailure(
	label: string,
	error: unknown,
	fields: SafeDiagnosticFields = {}
): void {
	const code = refusalCode(error);
	try {
		if (dev) console.error(label, error);
		else logSafeDiagnostic(code ? 'warn' : 'error', label, { ...fields, code });
	} catch {
		// A broken console cannot be reported to, and must not cost the capture.
	}
	if (code) return;
	try {
		loadedSentry()?.captureException(error, {
			mechanism: { type: 'recovered_failure', handled: true }
		});
	} catch {
		// Reporting is best effort. The console line above already names the failure.
	}
}
