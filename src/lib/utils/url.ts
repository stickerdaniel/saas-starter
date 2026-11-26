import { VERIFICATION_FAILURE_CODES } from './auth-messages';
import { isSupportedLanguage } from '#lib/i18n/languages.js';

/**
 * Allowlist-validates a redirect URL: only same-origin root-relative paths
 * (starting with a single /) pass. Everything else returns the fallback, and
 * the accepted value is re-emitted in canonical form, so the validated string
 * is the navigated string.
 *
 * Rejects absolute and scheme-relative URLs (`//evil.com`, `http:evil.com`),
 * backslash-authority variants (`/\evil.com`), embedded credentials, control
 * characters (raw and once-decoded, so a later decode layer cannot resurrect a
 * rejected vector), and dot segments that normalize into a network path
 * (`/.//evil.com`).
 */
export function safeRedirectPath(url: string, fallback: string): string {
	if (!url || !url.startsWith('/') || hasUnsafeUrlCharacters(url)) return fallback;

	try {
		const decoded = decodeURIComponent(url);
		if (decoded.startsWith('//') || decoded.startsWith('/\\') || hasControlCharacters(decoded))
			return fallback;

		const base = new URL('https://redirect.invalid');
		const parsed = new URL(url, base);
		if (parsed.origin !== base.origin || parsed.username || parsed.password) return fallback;
		const canonical = `${parsed.pathname}${parsed.search}${parsed.hash}`;
		// Dot segments can normalize into a network path: `/.//evil.com` becomes `//evil.com`.
		return canonical.startsWith('//') ? fallback : canonical;
	} catch {
		return fallback;
	}
}

/**
 * Narrows a caller-supplied destination to a page of this application.
 *
 * `safeRedirectPath` keeps a path on this origin, and every path stays there.
 * That is not enough for a destination sign-in hands to Better Auth: the same
 * value becomes the `callbackURL` of the recovery verification link, and a
 * failure is reported by appending `?error=<CODE>` to it, so a server hook has
 * to see the destination. `/favicon.ico` is same-origin and passes the callback
 * grammar, and Cloudflare answers it from the asset store before the Worker
 * runs, so the failure would arrive as an icon and say nothing.
 *
 * The language prefix costs nothing for the application's own links:
 * `handleLanguage` redirects a prefixless path before any auth rule reads it,
 * so every destination it writes carries one. The prefix must be a supported
 * language, not two letters: `/zz/app` would pass and then be localized into
 * `/en/zz/app`, a 404.
 *
 * A hand-written prefixless deep link such as `/pricing` is refused. Nothing
 * here tells it apart from `/favicon.ico`, the case this exists to stop.
 */
export function safeAuthDestination(url: string, fallback: string): string {
	const path = safeRedirectPath(url, fallback);
	return isSupportedLanguage(path.match(/^\/([a-z]{2})(?:[/?#]|$)/)?.[1]) ? path : fallback;
}

/**
 * Build an auth page URL that carries an outstanding destination in its query.
 *
 * The callback rule in {@link callbackURLFor} forbids `#`, so a destination with
 * a fragment would be dropped as a callback. Inside the query it becomes `%23`
 * and passes.
 *
 * `pagePath` is constructed locally and trusted, while `destination` is not. An
 * invalid destination leaves the bare page.
 */
export function authPageURL(pagePath: string, destination: string): string {
	const safeDestination = safeAuthDestination(destination, '');
	if (!safeDestination) return pagePath;

	// The guard applies to `pagePath`. Encoding yields only unreserved characters
	// and percent escapes that the query grammar permits.
	return callbackURLFor(
		`${pagePath}?redirectTo=${encodeCallbackComponent(safeDestination)}`,
		pagePath
	);
}

/**
 * `encodeURIComponent` plus the six characters it leaves raw.
 *
 * `!'()*~` are outside the callback grammar of {@link callbackURLFor}. Left
 * unescaped, the URL falls back to the bare page and the deep link is lost.
 */
function encodeCallbackComponent(value: string): string {
	return encodeURIComponent(value).replace(
		/[!'()*~]/g,
		(character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`
	);
}

function hasUnsafeUrlCharacters(value: string): boolean {
	return value.includes('\\') || hasControlCharacters(value);
}

function hasControlCharacters(value: string): boolean {
	return [...value].some((character) => {
		const code = character.charCodeAt(0);
		return code <= 31 || code === 127;
	});
}

/**
 * The URL Better Auth returns to when an OAuth callback fails.
 *
 * The failure happens after the browser left the page that started the flow,
 * so the reason can only travel back through a redirect. The default error URL
 * sends production users to the marketing homepage with the code in a
 * parameter nothing reads.
 *
 * `redirectTo` is carried through so a failed attempt keeps the user's
 * destination. It stays on the wide check and not `safeAuthDestination`: here
 * it rides inside the query of a page this module chose, failures are not
 * appended to it, and the page narrows it again when it navigates. It is
 * untrusted input from the current URL, so it passes the same allowlist as a
 * navigation before being embedded, and the result is narrowed again. This
 * field is origin-checked like any other callback, and `encodeURIComponent`
 * leaves `!~'()*` unescaped, so a destination with one of them would fail the
 * whole social sign-in with a 403 instead of losing only the deep link.
 */
export function oauthErrorCallbackURL(pagePath: string, redirectTo: string): string {
	const safeRedirectTo = safeRedirectPath(redirectTo, '');
	if (!safeRedirectTo) return pagePath;

	return callbackURLFor(`${pagePath}?redirectTo=${encodeURIComponent(safeRedirectTo)}`, pagePath);
}

export function resumeErrorCallbackURL(pagePath: string, search: string): string {
	const query = new URLSearchParams(search).toString().replaceAll('*', '%2A');
	return query ? callbackURLFor(`${pagePath}?${query}`, pagePath) : pagePath;
}

/**
 * Marks a failed password-reset link that the hook sends on to sign-in.
 *
 * Better Auth rejects a reset link with the same `INVALID_TOKEN` a verification
 * link uses, and once the reset page is unwrapped from the destination nothing
 * else tells the two apart. Sign-in words them differently for a visitor who is
 * already signed in.
 */
export const FAILED_LINK_PARAM = 'link';
export const FAILED_RESET_LINK = 'reset';

/**
 * The verification code Better Auth appended, out of every `error` value present.
 *
 * Not the first value and not the last: a destination is free to carry an
 * `error` of its own, and Better Auth appends after it, so position identifies
 * nothing. The code is the value that belongs to this namespace.
 */
export function verificationErrorIn(params: Pick<URLSearchParams, 'getAll'>): string | null {
	return params.getAll('error').find((code) => VERIFICATION_FAILURE_CODES.has(code)) ?? null;
}

/**
 * Splits a Better Auth link failure off a destination path.
 *
 * A verification link carries the caller's destination as its `callbackURL`,
 * and Better Auth reports a failure by appending `?error=<CODE>` to that URL
 * (`redirectOnError` in better-auth/dist/api/routes/email-verification.mjs).
 * For a protected destination the browser then bounces to sign-in with the
 * whole URL wrapped into `redirectTo`, so the code arrives one level down where
 * nothing looks for it.
 *
 * Left in place it also rides into the next verification link, and a later
 * successful verification lands on the destination still carrying the previous
 * failure.
 *
 * Only the codes that route reports are consumed. An `error` parameter is
 * ordinary for a destination, and swallowing the application's own would report
 * it as an auth failure and drop the state the caller asked to arrive with.
 */
export function splitDestinationError(destination: string): {
	destination: string;
	errorCode: string | null;
} {
	if (!destination.includes('error=')) return { destination, errorCode: null };

	try {
		const base = new URL('https://redirect.invalid');
		const parsed = new URL(destination, base);
		// Every occurrence, not the first: a destination with an `error` of its own
		// pushes the appended code into second place, which is the case where the user
		// learns nothing about a failed link.
		const errorCode = verificationErrorIn(parsed.searchParams);
		if (errorCode === null) {
			return { destination, errorCode: null };
		}

		// Every occurrence of that code, not the parameter and not one occurrence. An
		// `error` the caller put in the destination survives, because it belongs to a
		// different namespace. A leftover copy of the appended code would let a later
		// successful link land carrying the previous failure.
		const kept = new URLSearchParams();
		for (const [key, value] of parsed.searchParams) {
			if (key === 'error' && value === errorCode) {
				continue;
			}
			kept.append(key, value);
		}

		const search = kept.toString();
		return {
			destination: `${parsed.pathname}${search ? `?${search}` : ''}${parsed.hash}`,
			errorCode
		};
	} catch {
		return { destination, errorCode: null };
	}
}

/**
 * Narrows a destination to what Better Auth accepts as a `callbackURL`.
 *
 * Its origin check applies its own relative-path rule to that field
 * (`isSafeRelativeURL` in better-auth/dist/auth/trusted-origins.mjs). A refused
 * value comes back as `403 INVALID_CALLBACK_URL`, which the sign-in form can
 * only report as a failed sign-in, so correct credentials look wrong and an
 * unverified account never gets its recovery mail. Losing a deep link is the
 * smaller failure, so a destination outside this rule falls back.
 *
 * This rule is narrower than Better Auth's: it takes no fragment and no percent
 * escape in the path, both of which Better Auth 1.7 accepts. The containment is
 * checked against the real dependency in
 * src/lib/utils/__tests__/callback-url.contract.test.ts.
 */
export function callbackURLFor(destination: string, fallback: string): string {
	const accepted = /^\/(?!\/|\\|%2f|%5c)[\w\-.+/@]*(?:\?[\w\-.+/=&%@]*)?$/i;
	return accepted.test(destination) ? destination : fallback;
}
