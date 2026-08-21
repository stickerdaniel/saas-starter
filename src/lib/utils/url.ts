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
