/**
 * Whitelist-validates a redirect URL: only same-origin relative paths are
 * allowed. Everything else returns the fallback.
 *
 * Resolves the candidate against a sentinel origin and keeps it only if the
 * origin did not change. A prefix check ("starts with / but not //") is not
 * enough: browsers and the WHATWG URL parser treat a backslash as a path
 * separator, so `/\evil.com` slips past a `//` check yet resolves to
 * `https://evil.com`. Resolving catches that, protocol-relative `//host`,
 * absolute URLs, and `javascript:` URIs in one test.
 */
export function safeRedirectPath(url: string, fallback: string): string {
	if (!url) return fallback;
	try {
		const resolved = new URL(url, 'http://redirect.invalid');
		return resolved.origin === 'http://redirect.invalid' ? url : fallback;
	} catch {
		return fallback;
	}
}
