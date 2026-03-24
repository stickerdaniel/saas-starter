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
 * Placeholders for vars accessed at module-analysis time.
 *
 * Convex bundles and statically analyzes modules before env vars are available.
 * `createApi()` in adapter.ts calls `createAuthOptions()` at load time to
 * extract the Better Auth schema, and `new Autumn()` in autumn.ts runs at
 * top level, so these vars must return something during analysis.
 * Placeholders are never used at runtime -- build-time validation
 * (validate-convex-env.ts) ensures the real values are set before deploy.
 */
const ANALYSIS_PLACEHOLDERS: Partial<Record<string, string>> = {
	BETTER_AUTH_SECRET: 'placeholder-secret-for-analysis',
	SITE_URL: 'https://placeholder.invalid',
	AUTUMN_SECRET_KEY: 'placeholder-key-for-analysis'
};

/**
 * Get a required env var or throw with a helpful message.
 * Only accepts keys marked `@required` in `.env-convex.schema`.
 *
 * Falls back to analysis placeholders for vars that are read at module load
 * time (before Convex sets env vars). All other missing vars throw immediately.
 */
export function requireEnv<K extends RequiredKeys>(name: K): string {
	const value = process.env[name as string];
	if (value) return value;

	const placeholder = ANALYSIS_PLACEHOLDERS[name as string];
	if (placeholder) return placeholder;

	throw new Error(
		`Missing required environment variable: ${name}\n` +
			`Set via: bunx convex env set ${name} <value>`
	);
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
