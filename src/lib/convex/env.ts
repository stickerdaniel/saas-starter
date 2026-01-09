/**
 * Centralized Environment Variable Access
 *
 * This module provides typed access to environment variables.
 * All required variables are validated at module load time - if any are missing,
 * a single error is thrown listing all missing variables.
 */

// =============================================================================
// REQUIRED VARIABLES - All validated at module load time
// =============================================================================

const REQUIRED_ENV_VARS = {
	BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET,
	SITE_URL: process.env.SITE_URL ?? process.env.PUBLIC_SITE_URL,
	EMAIL_ASSET_URL: process.env.EMAIL_ASSET_URL,
	AUTH_EMAIL: process.env.AUTH_EMAIL,
	AUTUMN_SECRET_KEY: process.env.AUTUMN_SECRET_KEY,
	RESEND_API_KEY: process.env.RESEND_API_KEY,
	OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
	RESEND_WEBHOOK_SECRET: process.env.RESEND_WEBHOOK_SECRET
} as const;

// Validate all required env vars at module load time
const missingVars = Object.entries(REQUIRED_ENV_VARS)
	.filter(([, value]) => !value)
	.map(([name]) => name);

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

// =============================================================================
// TYPE-SAFE GETTERS - Guaranteed to return values after validation
// =============================================================================

/** Authentication secret for signing sessions */
export const getBetterAuthSecret = () => REQUIRED_ENV_VARS.BETTER_AUTH_SECRET!;

/** Site URL for OAuth redirects and email deep links */
export const getSiteUrl = () => REQUIRED_ENV_VARS.SITE_URL!;

/** Email asset URL for images */
export const getEmailAssetUrl = () => REQUIRED_ENV_VARS.EMAIL_ASSET_URL!;

/** Email sender address */
export const getAuthEmail = () => REQUIRED_ENV_VARS.AUTH_EMAIL!;

/** Autumn billing secret key */
export const getAutumnSecretKey = () => REQUIRED_ENV_VARS.AUTUMN_SECRET_KEY!;

/** Resend API key for email delivery */
export const getResendApiKey = () => REQUIRED_ENV_VARS.RESEND_API_KEY!;

/** OpenRouter API key for AI support chat */
export const getOpenRouterApiKey = () => REQUIRED_ENV_VARS.OPENROUTER_API_KEY!;

/** Resend webhook secret for signature verification */
export const getResendWebhookSecret = () => REQUIRED_ENV_VARS.RESEND_WEBHOOK_SECRET!;

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
