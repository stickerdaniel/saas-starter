/**
 * Threshold above which the device clock is treated as misconfigured. NTP keeps
 * real clocks within a few seconds, so 2 minutes is far beyond normal drift or
 * request latency, yet well under the auth cookie TTL where skew starts breaking
 * sign-in.
 */
export const SKEW_THRESHOLD_MS = 120_000;

/**
 * Estimate client-minus-server skew from a round-tripped time sample, correcting
 * for network latency by anchoring the client reading to the midpoint of the
 * request window.
 *
 * @param requestStart client `Date.now()` before the fetch
 * @param requestEnd   client `Date.now()` after the response resolved
 * @param serverNow    server `Date.now()` carried in the response body
 * @returns positive => client clock ahead of the server; negative => behind
 */
export function computeSkewMs(requestStart: number, requestEnd: number, serverNow: number): number {
	const clientMidpoint = requestStart + (requestEnd - requestStart) / 2;
	return clientMidpoint - serverNow;
}

/** A measured skew counts as a problem only past the threshold; `null` = not yet measured. */
export function isClockSkewed(skewMs: number | null): boolean {
	return skewMs !== null && Math.abs(skewMs) >= SKEW_THRESHOLD_MS;
}

/**
 * Compact, locale-neutral magnitude of the skew for display inside a localized
 * sentence (e.g. "6 h", "12 min", "45 s"). Direction is intentionally omitted:
 * "your clock is off by ~6 h" is the actionable part; ahead-vs-behind is noise.
 */
export function formatSkewMagnitude(skewMs: number | null): string {
	if (skewMs === null) return '';
	const abs = Math.abs(skewMs);
	if (abs >= 3_600_000) return `${Math.round(abs / 3_600_000)} h`;
	if (abs >= 60_000) return `${Math.round(abs / 60_000)} min`;
	return `${Math.round(abs / 1000)} s`;
}
