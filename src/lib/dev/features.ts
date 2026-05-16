/**
 * Catalog of optional features and the env keys that gate them.
 *
 * Used by `devNotice` to format consistent dev-time warnings when a gated
 * feature degrades silently in local dev. The catalog is also designed to
 * be reusable by future boot-time diagnostics (banners, doctor scripts) —
 * keep this file free of runtime side effects so it can be imported from
 * any context, including the Vite config loader.
 *
 * **Constraints (important):**
 * No imports from `$env/*`, no Convex `_generated/*`, no Svelte runtime
 * imports. Plain TypeScript and string constants only.
 */

export type DevFeatureScope = 'convex' | 'sveltekit' | 'vite-public';

export type DevFeature = {
	/** Human-readable feature name (shown in notices and banner). */
	name: string;
	/** Where the env vars live. Determines the fix command we suggest. */
	scope: DevFeatureScope;
	/** Env var names that gate the feature (must all be set to enable it). */
	missing: readonly string[];
	/** Reference doc / example file to point developers at. */
	docs?: string;
};

export const DEV_FEATURES = [
	{
		name: 'Email delivery (Resend)',
		scope: 'convex',
		missing: ['RESEND_API_KEY', 'AUTH_EMAIL'],
		docs: '.env.convex.example'
	},
	{
		name: 'Email webhook signature verification (Resend)',
		scope: 'convex',
		missing: ['RESEND_WEBHOOK_SECRET'],
		docs: '.env.convex.example'
	},
	{
		name: 'Google sign-in',
		scope: 'convex',
		missing: ['AUTH_GOOGLE_ID', 'AUTH_GOOGLE_SECRET'],
		docs: '.env.convex.example'
	},
	{
		name: 'GitHub sign-in',
		scope: 'convex',
		missing: ['AUTH_GITHUB_ID', 'AUTH_GITHUB_SECRET'],
		docs: '.env.convex.example'
	},
	{
		name: 'Billing (Autumn)',
		scope: 'convex',
		missing: ['AUTUMN_SECRET_KEY'],
		docs: '.env.convex.example'
	},
	{
		name: 'Product analytics (PostHog)',
		scope: 'vite-public',
		missing: ['PUBLIC_POSTHOG_API_KEY', 'PUBLIC_POSTHOG_HOST'],
		docs: '.env.schema'
	},
	{
		name: 'Error monitoring (Sentry)',
		scope: 'vite-public',
		missing: ['PUBLIC_SENTRY_DSN'],
		docs: '.env.schema'
	},
	{
		name: 'Tolgee in-context translation editing',
		scope: 'vite-public',
		missing: ['VITE_TOLGEE_API_KEY'],
		docs: '.env.schema'
	}
] as const satisfies readonly DevFeature[];

/**
 * Returns the canonical fix command for a given scope.
 *
 * `convex` keys need `bunx convex env set NAME value` against the local
 * embedded backend (or the cloud deployment). `sveltekit` and `vite-public`
 * keys are added to `.env.local`.
 */
export function fixHintFor(scope: DevFeatureScope, key: string): string {
	if (scope === 'convex') return `bunx convex env set ${key} <value>`;
	return `add ${key}=<value> to .env.local`;
}
