/**
 * The visitor's analytics decision, stored in one essential first-party cookie.
 *
 * `v1.granted.<grantId>.<expiresAt>`: consent for one period. `grantId` names the
 * period so a stale tab can tell a new grant from the one it started with; `expiresAt`
 * (epoch seconds) lets an open page close itself when the period ends.
 * `v1.denied`: an explicit refusal. Anything else, including an expired grant or two
 * conflicting cookies, is pending: analytics stays off and the visitor is asked again.
 */

export const CONSENT_COOKIE = 'analytics_consent';
/** How long one decision lasts before the visitor is asked again. */
export const CONSENT_LIFETIME_SECONDS = 180 * 24 * 60 * 60;

export type ConsentRecord =
	| { status: 'granted'; grantId: string; expiresAt: number }
	| { status: 'denied' }
	| { status: 'pending' };

const GRANTED = /^v1\.granted\.([A-Za-z0-9_-]{16,32})\.(\d{10})$/;
const PENDING: ConsentRecord = { status: 'pending' };

function parseValue(value: string, nowSeconds: number): ConsentRecord {
	if (value === 'v1.denied') return { status: 'denied' };
	const match = GRANTED.exec(value);
	const [, grantId, expires] = match ?? [];
	if (!grantId || !expires) return PENDING;
	const expiresAt = Number(expires);
	if (expiresAt <= nowSeconds) return PENDING;
	return { status: 'granted', grantId, expiresAt };
}

/** Reads the decision from a `document.cookie` string. */
export function parseConsentCookie(cookieHeader: string, nowSeconds: number): ConsentRecord {
	const values = new Set<string>();
	for (const part of cookieHeader.split(';')) {
		const separator = part.indexOf('=');
		if (separator === -1) continue;
		if (part.slice(0, separator).trim() !== CONSENT_COOKIE) continue;
		values.add(part.slice(separator + 1).trim());
	}
	// Two different values mean two cookies on different paths or domains; which one
	// the browser sends first is not a decision the visitor made.
	const [value] = values;
	if (values.size !== 1 || value === undefined) return PENDING;
	return parseValue(value, nowSeconds);
}

function cookieAttributes(maxAgeSeconds: number, secure: boolean): string {
	return `Max-Age=${maxAgeSeconds}; Path=/; SameSite=Lax${secure ? '; Secure' : ''}`;
}

export function grantCookie(grantId: string, nowSeconds: number, secure: boolean): string {
	const expiresAt = nowSeconds + CONSENT_LIFETIME_SECONDS;
	return `${CONSENT_COOKIE}=v1.granted.${grantId}.${expiresAt}; ${cookieAttributes(CONSENT_LIFETIME_SECONDS, secure)}`;
}

export function denyCookie(secure: boolean): string {
	return `${CONSENT_COOKIE}=v1.denied; ${cookieAttributes(CONSENT_LIFETIME_SECONDS, secure)}`;
}

/** A random id for one consent period; never derived from the account or device. */
export function createGrantId(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(16));
	return btoa(String.fromCharCode(...bytes))
		.replace(/\+/g, '-')
		.replace(/\//g, '_')
		.replace(/=+$/, '');
}
