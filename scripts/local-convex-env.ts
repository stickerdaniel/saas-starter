export const MANAGED_LOCAL_PROVIDER_KEYS = [
	'RESEND_API_KEY',
	'AUTH_EMAIL',
	'EMAIL_ASSET_URL',
	'AUTUMN_SECRET_KEY',
	'OPENROUTER_API_KEY'
] as const;

/**
 * Synchronize only provider values whose absence means deliberate local removal.
 * Other backend values persist when omitted from `.env.convex.local`.
 */
export function getManagedProviderUpdates(
	environment: Readonly<Record<string, string>>
): Record<(typeof MANAGED_LOCAL_PROVIDER_KEYS)[number], string | null> {
	return Object.fromEntries(
		MANAGED_LOCAL_PROVIDER_KEYS.map((key) => [key, environment[key] ?? null])
	) as Record<(typeof MANAGED_LOCAL_PROVIDER_KEYS)[number], string | null>;
}

/**
 * The origin of a developer-supplied URL, for logging.
 *
 * `.env.convex.local` holds secrets, and a URL a developer typed can carry
 * userinfo or a query token. The one place such a value still reaches the
 * console is the warning about an ignored `SITE_URL`, so it is reduced to
 * scheme, host and port — enough to say which stale value is being ignored,
 * without the credential-bearing parts.
 */
export function logSafeOrigin(value: string): string {
	try {
		return new URL(value).origin;
	} catch {
		return '<unparseable>';
	}
}
