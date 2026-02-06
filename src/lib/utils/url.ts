/**
 * Whitelist-validates a redirect URL: only relative paths (starting with /)
 * are allowed. Everything else returns the fallback.
 *
 * Prevents open redirect attacks by rejecting absolute URLs, protocol-relative
 * URLs (//evil.com), javascript: URIs, and any other non-relative path.
 */
export function safeRedirectPath(url: string, fallback: string): string {
	if (!url || !url.startsWith('/') || url.startsWith('//')) return fallback;
	return url;
}
