/**
 * Typed Convex Environment Variable Access
 *
 * Type source of truth: .env-convex.schema (varlock)
 * Generated types: ./convex-env.d.ts (via `varlock typegen --path .env-convex.schema`)
 * Build-time validation: scripts/validate-convex-env.ts
 */

import type { CoercedEnvSchema } from './convex-env';

// Extract keys whose type is `string` (required) vs `string | undefined` (optional)
type RequiredKeys = {
	[K in keyof CoercedEnvSchema]-?: undefined extends CoercedEnvSchema[K] ? never : K;
}[keyof CoercedEnvSchema];

/**
 * Get a required env var or throw with a helpful message.
 * Only accepts keys marked `@required` in `.env-convex.schema`.
 */
export function requireEnv<K extends RequiredKeys>(name: K): string {
	const value = process.env[name as string];
	if (!value) {
		throw new Error(
			`Missing required environment variable: ${name}\n` +
				`Set via: bunx convex env set ${name} <value>`
		);
	}
	return value;
}

// =============================================================================
// Optional OAuth providers - features gracefully disable if not set
// =============================================================================

/** Google OAuth - disabled if not configured */
export const googleOAuth = {
	enabled: !!(process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET),
	clientId: process.env.AUTH_GOOGLE_ID,
	clientSecret: process.env.AUTH_GOOGLE_SECRET
};

/** GitHub OAuth - disabled if not configured */
export const githubOAuth = {
	enabled: !!(process.env.AUTH_GITHUB_ID && process.env.AUTH_GITHUB_SECRET),
	clientId: process.env.AUTH_GITHUB_ID,
	clientSecret: process.env.AUTH_GITHUB_SECRET
};
