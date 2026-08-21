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
 * destination the user was heading for. It is untrusted input from the current
 * URL, so it passes the same whitelist as an actual navigation before being
 * embedded.
 */
export function oauthErrorCallbackURL(pagePath: string, redirectTo: string): string {
	const safeRedirectTo = safeRedirectPath(redirectTo, '');
	return safeRedirectTo ? `${pagePath}?redirectTo=${encodeURIComponent(safeRedirectTo)}` : pagePath;
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
 */
export function splitDestinationError(destination: string): {
	destination: string;
	errorCode: string | null;
} {
	if (!destination.includes('error=')) return { destination, errorCode: null };

	try {
		const base = new URL('https://redirect.invalid');
		const parsed = new URL(destination, base);
		const errorCode = parsed.searchParams.get('error');
		if (errorCode === null) return { destination, errorCode: null };

		parsed.searchParams.delete('error');
		return {
			destination: `${parsed.pathname}${parsed.search}${parsed.hash}`,
			errorCode
		};
	} catch {
		return { destination, errorCode: null };
	}
}
