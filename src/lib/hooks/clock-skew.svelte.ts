import { Context } from 'runed';
import { browser } from '$app/environment';
import { computeSkewMs, isClockSkewed, formatSkewMagnitude } from '$lib/utils/clock-skew';

/**
 * Per-request clock-skew state, shared via context.
 *
 * A misconfigured device clock silently breaks cookie-based auth: the browser
 * treats freshly minted short-TTL auth cookies as already expired (RFC 6265), so
 * the authenticated session never establishes and a plain reload can't fix it.
 * We measure the client/server offset once after hydration and let the UI surface
 * an actionable notice.
 *
 * Instantiated per request in the root layout — never a module-level singleton,
 * which would leak across SSR requests.
 */
export class ClockSkewState {
	/** Client minus server, in ms; `null` until measured. */
	skewMs = $state<number | null>(null);

	get isSkewed(): boolean {
		return isClockSkewed(this.skewMs);
	}

	/** Compact magnitude (e.g. "6 h") for embedding in localized copy. */
	get magnitude(): string {
		return formatSkewMagnitude(this.skewMs);
	}

	/** Sample server time once and record the offset. No-op on the server or after a first read. */
	async measure(): Promise<void> {
		if (!browser || this.skewMs !== null) return;
		try {
			const requestStart = Date.now();
			const res = await fetch('/api/time', { cache: 'no-store' });
			const requestEnd = Date.now();
			const body = (await res.json()) as { now?: unknown };
			if (typeof body.now === 'number') {
				this.skewMs = computeSkewMs(requestStart, requestEnd, body.now);
			}
		} catch {
			// Offline / network error: leave unmeasured. The connection fallback
			// covers the generic "can't reach the server" case.
		}
	}
}

export const clockSkewContext = new Context<ClockSkewState>('clock-skew');
