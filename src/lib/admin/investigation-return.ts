import { safeAuthDestination } from '#lib/utils/url.js';

/**
 * The admin page an impersonation started from, kept so stopping returns there.
 *
 * Kept in a cookie because impersonation itself is cookie-scoped: a second tab
 * in the same profile is already the customer, and stopping there has to know
 * the origin too, which tab storage would not. It is navigation metadata only; `/admin/**` still
 * requires an admin JWT, so a forged value can at most pick which admin page
 * an admin lands on.
 */
export const INVESTIGATION_RETURN_COOKIE = 'admin_investigation_return';

// The impersonated session's lifetime (Better Auth's default, not overridden in
// src/lib/convex/auth.ts). An older origin belongs to an investigation that has
// already ended on its own.
const MAX_AGE_SECONDS = 3600;
// Browsers drop a cookie past roughly 4 KB of name and value without saying so;
// staying well under that keeps the write and the read agreeing.
const MAX_SERIALIZED_BYTES = 3072;
const MAX_TARGET_BYTES = 2048;
const ADMIN_PATH = /^\/[a-z]{2}\/admin(?:\/|$)/;

const encoder = new TextEncoder();

function byteLength(value: string): number {
	return encoder.encode(value).length;
}

/**
 * Narrow a value to an admin page of this application, without its fragment.
 * Returns `null` for anything else.
 */
export function adminReturnTarget(value: string | null | undefined): string | null {
	if (typeof value !== 'string' || value.length === 0) return null;
	const safe = safeAuthDestination(value, '');
	if (!safe) return null;
	const target = safe.replace(/#.*$/s, '');
	if (!ADMIN_PATH.test(target.replace(/\?.*$/s, ''))) return null;
	return byteLength(target) <= MAX_TARGET_BYTES ? target : null;
}

function serialize(target: string): string | null {
	const pair = `${INVESTIGATION_RETURN_COOKIE}=${encodeURIComponent(target)}`;
	return byteLength(pair) <= MAX_SERIALIZED_BYTES ? pair : null;
}

function attributes(maxAge: number): string {
	const secure = globalThis.location?.protocol === 'https:' ? '; Secure' : '';
	return `; Path=/; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

/**
 * Record where a just-started impersonation should return to.
 *
 * Every successful start replaces the previous value. A target that cannot be
 * stored deletes it instead, because keeping it would send this investigation
 * back to wherever the last one began.
 */
export function writeInvestigationReturn(target: string | null): void {
	if (typeof document === 'undefined') return;
	const valid = adminReturnTarget(target);
	const pair = valid === null ? null : serialize(valid);
	if (pair === null) {
		clearInvestigationReturn();
		return;
	}
	document.cookie = `${pair}${attributes(MAX_AGE_SECONDS)}`;
}

/** The stored admin page, or `null` when absent, expired or not an admin page. */
export function readInvestigationReturn(): string | null {
	if (typeof document === 'undefined') return null;
	const prefix = `${INVESTIGATION_RETURN_COOKIE}=`;
	const raw = document.cookie
		.split(';')
		.map((part) => part.trim())
		.find((part) => part.startsWith(prefix))
		?.slice(prefix.length);
	if (!raw) return null;
	try {
		// Any script on the origin can write this cookie, so every read passes the
		// same check a start does.
		return adminReturnTarget(decodeURIComponent(raw));
	} catch {
		return null;
	}
}

export function clearInvestigationReturn(): void {
	if (typeof document === 'undefined') return;
	document.cookie = `${INVESTIGATION_RETURN_COOKIE}=${attributes(0)}`;
}
