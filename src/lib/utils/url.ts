import { VERIFICATION_FAILURE_CODES } from './auth-messages';

/**
 * Whitelist-validates a redirect URL: only same-origin root-relative paths
 * (starting with a single /) are allowed. Everything else returns the fallback,
 * and the accepted value is re-emitted in canonical form so the string that
 * passed validation is the string that gets navigated.
 *
 * Prevents open redirect attacks by rejecting absolute and scheme-relative URLs
 * (`//evil.com`, `http:evil.com`), backslash-authority variants (`/\evil.com`),
 * embedded credentials, and control characters — both raw and once-decoded, so
 * a later decode layer cannot resurrect a rejected vector.
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
		return `${parsed.pathname}${parsed.search}${parsed.hash}`;
	} catch {
		return fallback;
	}
}

/**
 * Narrow a caller-supplied destination to a page of this application.
 *
 * `safeRedirectPath` answers the open-redirect question, which is whether a
 * path stays on this origin, and every path does. That is not enough for a
 * destination sign-in hands to Better Auth: the same value becomes the
 * `callbackURL` of the recovery verification link, and a failure is reported by
 * appending `?error=<CODE>` to it, so the destination also has to be something
 * a server hook will see. `/favicon.ico` is same-origin and passes the callback
 * grammar, and Cloudflare answers it from the asset store before this
 * application's Worker is reached at all, so the failure would arrive as an
 * icon and say nothing.
 *
 * Requiring the language prefix costs nothing, because `handleLanguage`
 * redirects a prefixless path before any auth rule reads it, so every
 * destination the application itself writes already carries one. What it leaves
 * out is exactly the static files, which are not pages and were never a
 * destination anyone asked for.
 */
export function safeAuthDestination(url: string, fallback: string): string {
	const path = safeRedirectPath(url, fallback);
	return /^\/[a-z]{2}(?:[/?#]|$)/.test(path) ? path : fallback;
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
 * Build the URL Better Auth returns to when an OAuth callback fails.
 *
 * The failure happens after the browser has left the page that started the
 * flow, so the reason can only travel back through a redirect. Without this the
 * default error URL applies, which sends production users to the marketing
 * homepage with the code in a parameter nothing reads.
 *
 * `redirectTo` is carried through so a failed attempt does not lose the
 * destination the user was heading for. It stays on the wide check rather than
 * `safeAuthDestination`: here it is a passenger inside the query of a page this
 * module already chose, not the destination a failure gets appended to, and the
 * page narrows it again when it actually navigates. It is untrusted input from the current
 * URL, so it passes the same whitelist as an actual navigation before being
 * embedded, and the result is narrowed again: this field is origin-checked like
 * any other callback, and `encodeURIComponent` leaves `!~'()*` unescaped, so a
 * destination carrying one of them would take the whole social sign-in down
 * with a 403 rather than merely losing the deep link.
 */
export function oauthErrorCallbackURL(pagePath: string, redirectTo: string): string {
	const safeRedirectTo = safeRedirectPath(redirectTo, '');
	if (!safeRedirectTo) return pagePath;

	return callbackURLFor(`${pagePath}?redirectTo=${encodeURIComponent(safeRedirectTo)}`, pagePath);
}

/**
 * Splits a Better Auth link failure off a destination path.
 *
 * A verification link carries the caller's destination as its `callbackURL`,
 * and Better Auth reports a failure by appending `?error=<CODE>` to exactly
 * that URL (`redirectOnError` in
 * better-auth/dist/api/routes/email-verification.mjs). When the destination is
 * a protected route, the browser is then bounced to sign-in with the whole
 * thing wrapped into `redirectTo`, so the code arrives buried one level down
 * where nothing looks for it and the user is told nothing at all.
 *
 * Left in place it also rides into the next verification link, and a later
 * successful verification lands on the destination still carrying the failure
 * of the previous attempt.
 *
 * Only the codes that route reports are consumed. An `error` parameter is an
 * ordinary thing for a destination to carry, and swallowing the application's
 * own would both report it as an auth failure and drop the state the caller
 * asked to arrive with.
 */
export function splitDestinationError(destination: string): {
	destination: string;
	errorCode: string | null;
} {
	if (!destination.includes('error=')) return { destination, errorCode: null };

	try {
		const base = new URL('https://redirect.invalid');
		const parsed = new URL(destination, base);
		// Every occurrence, not the first: a destination that already carried an
		// `error` of its own pushes the appended code into second place, which is
		// precisely the case where the user learns nothing about a link that
		// failed.
		const errorCode =
			parsed.searchParams.getAll('error').find((code) => VERIFICATION_FAILURE_CODES.has(code)) ??
			null;
		if (errorCode === null) {
			return { destination, errorCode: null };
		}

		// One occurrence removed rather than the parameter, so an `error` the
		// caller put in the destination itself arrives intact.
		const kept = new URLSearchParams();
		let dropped = false;
		for (const [key, value] of parsed.searchParams) {
			if (!dropped && key === 'error' && value === errorCode) {
				dropped = true;
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
 * Narrow a destination to what Better Auth will accept as a `callbackURL`.
 *
 * Its origin check applies its own relative-path rule to that field, and that
 * rule is stricter than this module's: it takes no fragment and no percent
 * escape in the path (`matchesOriginPattern` in
 * better-auth/dist/auth/trusted-origins.mjs). A value it refuses comes back as
 * `403 INVALID_CALLBACK_URL`, which the sign-in form can only report as a
 * failed sign-in, so correct credentials look wrong and an unverified account
 * never gets its recovery mail. Losing a deep link is the smaller failure, so a
 * destination outside the rule falls back rather than being sent.
 *
 * The shape is pinned against the real dependency in
 * src/lib/utils/__tests__/callback-url.contract.test.ts.
 */
export function callbackURLFor(destination: string, fallback: string): string {
	const accepted = /^\/(?!\/|\\|%2f|%5c)[\w\-.+/@]*(?:\?[\w\-.+/=&%@]*)?$/i;
	return accepted.test(destination) ? destination : fallback;
}
