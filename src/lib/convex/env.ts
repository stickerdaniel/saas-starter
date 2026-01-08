/**
 * Centralized Environment Variable Validation
 *
 * This module validates all required environment variables at module load time.
 * In production, missing required variables will cause deployment to fail immediately
 * with clear instructions on how to fix.
 */

const isProduction = process.env.NODE_ENV === 'production';

// =============================================================================
// REQUIRED VARIABLES - App will not function without these
// =============================================================================

const BETTER_AUTH_SECRET = process.env.BETTER_AUTH_SECRET;
const SITE_URL = process.env.SITE_URL ?? process.env.PUBLIC_SITE_URL;
const APP_URL = process.env.APP_URL;
const AUTH_EMAIL = process.env.AUTH_EMAIL;
const AUTUMN_SECRET_KEY = process.env.AUTUMN_SECRET_KEY;
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const RESEND_WEBHOOK_SECRET = process.env.RESEND_WEBHOOK_SECRET;

if (isProduction) {
	const errors: string[] = [];

	if (!BETTER_AUTH_SECRET) {
		errors.push(`
BETTER_AUTH_SECRET is required for authentication.

Set via CLI:
  bunx convex env set BETTER_AUTH_SECRET "$(openssl rand -base64 32)" --prod

Or set in Convex Dashboard:
  https://dashboard.convex.dev → Your Project → Settings → Environment Variables
`);
	}

	if (!SITE_URL) {
		errors.push(`
SITE_URL is required for OAuth redirects and authentication callbacks.

Set via CLI:
  bunx convex env set SITE_URL https://your-domain.com --prod

Or set in Convex Dashboard:
  https://dashboard.convex.dev → Your Project → Settings → Environment Variables
`);
	}

	if (!APP_URL) {
		errors.push(`
APP_URL is required for email links and deep links.

Set via CLI:
  bunx convex env set APP_URL https://your-domain.com --prod

Or set in Convex Dashboard:
  https://dashboard.convex.dev → Your Project → Settings → Environment Variables
`);
	}

	if (!AUTH_EMAIL) {
		errors.push(`
AUTH_EMAIL is required as the sender address for authentication emails.

Set via CLI:
  bunx convex env set AUTH_EMAIL noreply@your-domain.com --prod

Or set in Convex Dashboard:
  https://dashboard.convex.dev → Your Project → Settings → Environment Variables

Note: This email must be verified in your Resend dashboard.
`);
	}

	if (!AUTUMN_SECRET_KEY) {
		errors.push(`
AUTUMN_SECRET_KEY is required for billing and subscriptions.

Set via CLI:
  bunx convex env set AUTUMN_SECRET_KEY am_sk_... --prod

Or set in Convex Dashboard:
  https://dashboard.convex.dev → Your Project → Settings → Environment Variables

Get your secret key from: https://useautumn.com/dashboard
`);
	}

	if (!RESEND_API_KEY) {
		errors.push(`
RESEND_API_KEY is required for sending emails (verification, password reset, notifications).

Set via CLI:
  bunx convex env set RESEND_API_KEY re_... --prod

Or set in Convex Dashboard:
  https://dashboard.convex.dev → Your Project → Settings → Environment Variables

Get your API key from: https://resend.com/api-keys
`);
	}

	if (!OPENROUTER_API_KEY) {
		errors.push(`
OPENROUTER_API_KEY is required for the AI-powered customer support chat.

Set via CLI:
  bunx convex env set OPENROUTER_API_KEY sk-or-v1-... --prod

Or set in Convex Dashboard:
  https://dashboard.convex.dev → Your Project → Settings → Environment Variables

Get your API key from: https://openrouter.ai/keys
`);
	}

	if (!RESEND_WEBHOOK_SECRET) {
		errors.push(`
RESEND_WEBHOOK_SECRET is required to verify email webhook signatures.

Set via CLI:
  bunx convex env set RESEND_WEBHOOK_SECRET whsec_... --prod

Or set in Convex Dashboard:
  https://dashboard.convex.dev → Your Project → Settings → Environment Variables

Get your webhook secret from: https://resend.com/webhooks
`);
	}

	if (errors.length > 0) {
		throw new Error(
			`\n${'='.repeat(60)}\nMISSING REQUIRED ENVIRONMENT VARIABLES\n${'='.repeat(60)}\n` +
				errors.join('\n') +
				`\n${'='.repeat(60)}\n`
		);
	}
}

// =============================================================================
// EXPORTS - Use these getters throughout the codebase
// =============================================================================

/** Authentication secret for signing sessions */
export const getBetterAuthSecret = () => BETTER_AUTH_SECRET;

/** Site URL for OAuth redirects (with dev fallback) */
export const getSiteUrl = () => SITE_URL || 'http://localhost:5173';

/** App URL for email links (with dev fallback) */
export const getAppUrl = () => APP_URL || 'http://localhost:5173';

/** Email sender address (with dev fallback) */
export const getAuthEmail = () => AUTH_EMAIL || 'noreply@example.com';

/** Autumn billing secret key */
export const getAutumnSecretKey = () => AUTUMN_SECRET_KEY;

/** Resend API key for email delivery */
export const getResendApiKey = () => RESEND_API_KEY;

/** OpenRouter API key for AI support chat */
export const getOpenRouterApiKey = () => OPENROUTER_API_KEY;

/** Resend webhook secret for signature verification */
export const getResendWebhookSecret = () => RESEND_WEBHOOK_SECRET;

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
