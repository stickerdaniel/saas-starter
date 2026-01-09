/**
 * Centralized Environment Variable Access
 *
 * This module provides typed access to environment variables.
 * Fallbacks allow Convex module analysis to pass; actual values come from env vars at runtime.
 * Validation happens on first getter access - if any required vars are missing,
 * a single error is thrown listing all missing variables.
 */

// =============================================================================
// REQUIRED VARIABLES
// =============================================================================

const REQUIRED_VAR_NAMES = [
	'BETTER_AUTH_SECRET',
	'SITE_URL',
	'EMAIL_ASSET_URL',
	'AUTH_EMAIL',
	'AUTUMN_SECRET_KEY',
	'RESEND_API_KEY',
	'OPENROUTER_API_KEY',
	'RESEND_WEBHOOK_SECRET'
] as const;

type RequiredVarName = (typeof REQUIRED_VAR_NAMES)[number];
type ValidatedEnvVars = Record<RequiredVarName, string>;

// Fallbacks allow Convex module analysis to pass; actual values come from env vars at runtime
const RAW_ENV_VALUES: Record<RequiredVarName, string | undefined> = {
	BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET ?? 'placeholder-secret-for-analysis',
	SITE_URL: process.env.SITE_URL ?? process.env.PUBLIC_SITE_URL ?? 'https://placeholder.invalid',
	EMAIL_ASSET_URL: process.env.EMAIL_ASSET_URL,
	AUTH_EMAIL: process.env.AUTH_EMAIL,
	AUTUMN_SECRET_KEY: process.env.AUTUMN_SECRET_KEY,
	RESEND_API_KEY: process.env.RESEND_API_KEY,
	OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
	RESEND_WEBHOOK_SECRET: process.env.RESEND_WEBHOOK_SECRET
};

// Placeholder values that indicate the env var wasn't actually set
const PLACEHOLDER_VALUES: Partial<Record<RequiredVarName, string>> = {
	BETTER_AUTH_SECRET: 'placeholder-secret-for-analysis',
	SITE_URL: 'https://placeholder.invalid'
};

// Cache for validated env vars - typed as all strings after validation
let validatedEnvVars: ValidatedEnvVars | null = null;

/**
 * Validates all required env vars on first call.
 * Throws a single error listing ALL missing variables if any are missing.
 * Returns a properly typed object where all values are guaranteed to be strings.
 */
function getValidatedEnvVars(): ValidatedEnvVars {
	if (validatedEnvVars) return validatedEnvVars;

	const missingVars: string[] = [];

	for (const name of REQUIRED_VAR_NAMES) {
		const value = RAW_ENV_VALUES[name];
		const placeholder = PLACEHOLDER_VALUES[name];

		// Missing if undefined OR still has placeholder value
		if (!value || value === placeholder) {
			missingVars.push(name);
		}
	}

	if (missingVars.length > 0) {
		const errorMessage = [
			`Missing ${missingVars.length} required environment variable(s):`,
			'',
			...missingVars.map((name) => `  - ${name}`),
			'',
			'Set via:',
			'  Dev:     bunx convex env set <NAME> <value>',
			'  Prod:    bunx convex env set <NAME> <value> --prod',
			'  Preview: Set default in Convex Dashboard → Settings → Environment Variables'
		].join('\n');

		throw new Error(errorMessage);
	}

	// All vars present and not placeholders - safe to cast
	validatedEnvVars = RAW_ENV_VALUES as ValidatedEnvVars;
	return validatedEnvVars;
}

// =============================================================================
// TYPE-SAFE GETTERS - On successful module initialization, guaranteed to return values after validation
// =============================================================================

/** Authentication secret for signing sessions */
export const getBetterAuthSecret = () => getValidatedEnvVars().BETTER_AUTH_SECRET;

/** Site URL for OAuth redirects and email deep links */
export const getSiteUrl = () => getValidatedEnvVars().SITE_URL;

/** Email asset URL for images */
export const getEmailAssetUrl = () => getValidatedEnvVars().EMAIL_ASSET_URL;

/** Email sender address */
export const getAuthEmail = () => getValidatedEnvVars().AUTH_EMAIL;

/** Autumn billing secret key */
export const getAutumnSecretKey = () => getValidatedEnvVars().AUTUMN_SECRET_KEY;

/** Resend API key for email delivery */
export const getResendApiKey = () => getValidatedEnvVars().RESEND_API_KEY;

/** OpenRouter API key for AI support chat */
export const getOpenRouterApiKey = () => getValidatedEnvVars().OPENROUTER_API_KEY;

/** Resend webhook secret for signature verification */
export const getResendWebhookSecret = () => getValidatedEnvVars().RESEND_WEBHOOK_SECRET;

// =============================================================================
// OPTIONAL VARIABLES - Features gracefully disable if not set
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
