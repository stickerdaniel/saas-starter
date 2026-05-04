/**
 * Resolve the site URL e2e tests should hit.
 *
 * Local test mode (no CI): hard-code the test vite port. We deliberately ignore
 * PUBLIC_SITE_URL here because a stale gitignored .env.test could otherwise route
 * signups to a cloud preview while the Convex resolver points at the local backend
 * (asymmetric isolation = confusing failures).
 *
 * CI: workflow injects the real preview URL via PUBLIC_SITE_URL.
 *
 * Future explicit overrides should use a different variable name (e.g.
 * E2E_OVERRIDE_SITE_URL) so the cloud-leftover trap can't reopen.
 */
export function resolveSiteUrl(): string {
	if (!process.env.CI) return 'http://localhost:5174';
	return process.env.PUBLIC_SITE_URL || 'http://localhost:5173';
}
