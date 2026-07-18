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
