/**
 * Centralized Environment Variable Access
 *
 * This module provides typed access to environment variables.
 * Validation is performed at deploy time via the pre-deploy script
 * (scripts/vercel-deploy.sh) and at runtime via throwing getters.
 */

// =============================================================================
// REQUIRED VARIABLES - Validated at deploy time and runtime
// =============================================================================

const BETTER_AUTH_SECRET = process.env.BETTER_AUTH_SECRET;
// SITE_URL: Fallback allows module analysis to pass; actual value comes from env var at runtime
const SITE_URL =
	process.env.SITE_URL ?? process.env.PUBLIC_SITE_URL ?? 'https://placeholder.invalid';
const EMAIL_ASSET_URL = process.env.EMAIL_ASSET_URL;
const AUTH_EMAIL = process.env.AUTH_EMAIL;
const AUTUMN_SECRET_KEY = process.env.AUTUMN_SECRET_KEY;
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const RESEND_WEBHOOK_SECRET = process.env.RESEND_WEBHOOK_SECRET;

// =============================================================================
// EXPORTS - Throwing getters for required variables
// =============================================================================

function envError(name: string): Error {
	return new Error(
		`${name} not configured. Set via:\n` +
			`  Dev:     bunx convex env set ${name} <value>\n` +
			`  Prod:    bunx convex env set ${name} <value> --prod\n` +
			`  Preview: Set default in Convex Dashboard → Settings → Environment Variables\n` +
			`           (takes effect on next preview deployment)`
	);
}

/** Authentication secret for signing sessions */
export const getBetterAuthSecret = () => {
	if (!BETTER_AUTH_SECRET) throw envError('BETTER_AUTH_SECRET');
	return BETTER_AUTH_SECRET;
};

/** Site URL for OAuth redirects and email deep links */
export const getSiteUrl = () => {
	if (SITE_URL === 'https://placeholder.invalid') {
		console.warn('SITE_URL not configured - using placeholder. Auth will not work correctly.');
	}
	return SITE_URL;
};

/** Email asset URL for images */
export const getEmailAssetUrl = () => {
	if (!EMAIL_ASSET_URL) throw envError('EMAIL_ASSET_URL');
	return EMAIL_ASSET_URL;
};

/** Email sender address */
export const getAuthEmail = () => {
	if (!AUTH_EMAIL) throw envError('AUTH_EMAIL');
	return AUTH_EMAIL;
};

/** Autumn billing secret key */
export const getAutumnSecretKey = () => {
	if (!AUTUMN_SECRET_KEY) throw envError('AUTUMN_SECRET_KEY');
	return AUTUMN_SECRET_KEY;
};

/** Resend API key for email delivery */
export const getResendApiKey = () => {
	if (!RESEND_API_KEY) throw envError('RESEND_API_KEY');
	return RESEND_API_KEY;
};

/** OpenRouter API key for AI support chat */
export const getOpenRouterApiKey = () => {
	if (!OPENROUTER_API_KEY) throw envError('OPENROUTER_API_KEY');
	return OPENROUTER_API_KEY;
};

/** Resend webhook secret for signature verification */
export const getResendWebhookSecret = () => {
	if (!RESEND_WEBHOOK_SECRET) throw envError('RESEND_WEBHOOK_SECRET');
	return RESEND_WEBHOOK_SECRET;
};

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
