/**
 * Typed Convex Environment Variable Access
 *
 * Declared in: ./convex.config.ts (`defineApp` `env` block). Convex validates
 * presence and validators at push time and emits the typed `env` object below.
 * `env` is a plain alias of `process.env` (see `_generated/server`), so the
 * required/optional split comes for free: required vars type as `string`,
 * optional vars as `string | undefined`.
 *
 * varlock (.env-convex.schema) stays canonical for log redaction, leak
 * scanning, `@type=url`/`@type=boolean` coercion, and the SvelteKit runtime
 * side; `scripts/env-schema-parity.test.ts` keeps the two declarations in sync.
 */

import { env } from './_generated/server';

// Required keys type as `string`; optional keys as `string | undefined`.
type RequiredKeys = {
	[K in keyof typeof env]-?: undefined extends (typeof env)[K] ? never : K;
}[keyof typeof env];

/**
 * Placeholders for vars accessed at module-analysis time.
 *
 * Convex bundles and statically analyzes modules before env vars are available,
 * and `env` is just `process.env`, so a top-level read returns `undefined`
 * during that pass. `createApi()` in adapter.ts calls `createAuthOptions()` at
 * load time to extract the Better Auth schema, and `new Autumn()` in autumn.ts
 * runs at top level, so these vars must return something during analysis.
 * Placeholders are never used at runtime -- the declared `env` block makes
 * Convex reject a deploy that is missing the real values.
 */
const ANALYSIS_PLACEHOLDERS: Partial<Record<string, string>> = {
	BETTER_AUTH_SECRET: 'placeholder-secret-for-analysis',
	SITE_URL: 'https://placeholder.invalid',
	AUTUMN_SECRET_KEY: 'placeholder-key-for-analysis'
};

export type RequireEnvOptions = {
	/** Human-readable feature name this env var gates (e.g., "billing & checkout"). */
	feature?: string;
	/** Reference doc or example file path. Defaults to `.env.convex.example`. */
	docs?: string;
};

/**
 * Get a required env var or throw with a helpful message.
 * Only accepts keys marked `@required` in `.env-convex.schema`.
 *
 * Falls back to analysis placeholders for vars that are read at module load
 * time (before Convex sets env vars). All other missing vars throw immediately.
 *
 * Pass `opts.feature` to make the error message name the gated feature, which
 * surfaces a useful breadcrumb in Convex logs when an end-user flow trips it.
 */
export function requireEnv<K extends RequiredKeys>(name: K, opts?: RequireEnvOptions): string {
	const value = env[name];
	if (value) return value;

	const placeholder = ANALYSIS_PLACEHOLDERS[name as string];
	if (placeholder) return placeholder;

	const feature = opts?.feature ? ` (needed for: ${opts.feature})` : '';
	const docs = opts?.docs ?? '.env.convex.example';

	throw new Error(
		`[env] Missing ${name}${feature}\n` +
			`  Fix: bunx convex env set ${name} <value>\n` +
			`  See: ${docs}`
	);
}

// =============================================================================
// Optional OAuth providers - features gracefully disable if not set
// =============================================================================

/** Google OAuth - disabled if not configured */
export const googleOAuth = {
	enabled: !!(env.AUTH_GOOGLE_ID && env.AUTH_GOOGLE_SECRET),
	clientId: env.AUTH_GOOGLE_ID,
	clientSecret: env.AUTH_GOOGLE_SECRET
};

/** GitHub OAuth - disabled if not configured */
export const githubOAuth = {
	enabled: !!(env.AUTH_GITHUB_ID && env.AUTH_GITHUB_SECRET),
	clientId: env.AUTH_GITHUB_ID,
	clientSecret: env.AUTH_GITHUB_SECRET
};
