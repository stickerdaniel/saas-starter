/**
 * Centralized Environment Variable Access
 *
 * This module provides typed access to environment variables.
 * Validation is performed at deploy time via the pre-deploy script
 * (scripts/vercel-deploy.sh) which checks Convex env vars via CLI.
 */

// =============================================================================
// REQUIRED VARIABLES - Validated at deploy time via CLI
// =============================================================================

const BETTER_AUTH_SECRET = process.env.BETTER_AUTH_SECRET;
const SITE_URL = process.env.SITE_URL ?? process.env.PUBLIC_SITE_URL;
const EMAIL_ASSET_URL = process.env.EMAIL_ASSET_URL;
const AUTH_EMAIL = process.env.AUTH_EMAIL;
const AUTUMN_SECRET_KEY = process.env.AUTUMN_SECRET_KEY;
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const RESEND_WEBHOOK_SECRET = process.env.RESEND_WEBHOOK_SECRET;

// =============================================================================
// EXPORTS - Use these getters throughout the codebase
// =============================================================================

/** Authentication secret for signing sessions */
export const getBetterAuthSecret = () => BETTER_AUTH_SECRET;

/** Site URL for OAuth redirects and email deep links (with dev fallback) */
export const getSiteUrl = () => SITE_URL || 'http://localhost:5173';

/** Email asset URL for images - always production URL (with dev fallback) */
export const getEmailAssetUrl = () => EMAIL_ASSET_URL || 'http://localhost:5173';

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
