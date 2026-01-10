/**
 * Centralized Environment Variable Access
 *
 * Build-time validation: vercel-deploy.ts checks all required vars before deploy
 * Runtime validation: Getters throw if vars are missing (safety net for local dev)
 *
 * Auth vars (BETTER_AUTH_SECRET, SITE_URL) have placeholders to allow Convex
 * module analysis to pass during bundling. Placeholders are only used when:
 * - Convex bundles and analyzes the module before deploy-time validation
 * - Environment variables are not yet available during static analysis
 */

// =============================================================================
// REQUIRED VARIABLES - Single source of truth (used by vercel-deploy.ts)
// =============================================================================

export const REQUIRED_VAR_NAMES = [
	'BETTER_AUTH_SECRET',
	'SITE_URL',
	'EMAIL_ASSET_URL',
	'AUTH_EMAIL',
	'AUTUMN_SECRET_KEY',
	'RESEND_API_KEY',
	'OPENROUTER_API_KEY',
	'RESEND_WEBHOOK_SECRET'
] as const;

// =============================================================================
// PLACEHOLDERS - Allow Convex module analysis to pass during bundling
// Auth module is loaded at analysis time, so these vars need fallbacks
// =============================================================================

const AUTH_PLACEHOLDERS: Record<string, string> = {
	BETTER_AUTH_SECRET: 'placeholder-secret-for-analysis',
	SITE_URL: 'https://placeholder.invalid'
};

// =============================================================================
// RUNTIME VALIDATION - Throw all missing vars at once for better DX
// =============================================================================

let validationPerformed = false;

/**
 * Validates all required environment variables and throws a single error
 * listing all missing vars. Called automatically on first getter access.
 */
function validateAllRequiredVars(): void {
	if (validationPerformed) return;
	validationPerformed = true;

	const missingVars: string[] = [];

	for (const name of REQUIRED_VAR_NAMES) {
		const value = process.env[name];
		const hasPlaceholder = name in AUTH_PLACEHOLDERS;

		// Skip vars with placeholders (they're allowed to be missing during analysis)
		if (!value && !hasPlaceholder) {
			missingVars.push(name);
		}
	}

	if (missingVars.length > 0) {
		const varList = missingVars.map((name) => `  - ${name}`).join('\n');
		const setCommands = missingVars
			.map((name) => `  bunx convex env set ${name} <value>`)
			.join('\n');

		throw new Error(
			`Missing required environment variables:\n${varList}\n\n` +
				`Set them via CLI:\n${setCommands}\n\n` +
				`Or set in Convex Dashboard:\n` +
				`  https://dashboard.convex.dev → Your Project → Settings → Environment Variables`
		);
	}
}

// =============================================================================
// RUNTIME GETTERS - Validate all vars on first access, then return values
// =============================================================================

/**
 * Helper to get env var. Validates all required vars on first access,
 * then returns the requested value (or placeholder during module analysis).
 */
function getRequiredEnv(name: string, placeholder?: string): string {
	// First access triggers validation of ALL required vars
	validateAllRequiredVars();

	const value = process.env[name];

	// Use placeholder during Convex module analysis (when var not yet set)
	if (!value && placeholder) return placeholder;

	// This should never happen after validation, but safety net for edge cases
	if (!value) {
		throw new Error(
			`Missing required environment variable: ${name}\n` +
				`Set via: bunx convex env set ${name} <value>`
		);
	}

	return value;
}

/** Authentication secret for signing sessions */
export const getBetterAuthSecret = (): string =>
	getRequiredEnv('BETTER_AUTH_SECRET', AUTH_PLACEHOLDERS.BETTER_AUTH_SECRET);

/** Site URL for OAuth redirects and email deep links */
export const getSiteUrl = (): string => getRequiredEnv('SITE_URL', AUTH_PLACEHOLDERS.SITE_URL);

/** Email asset URL for images */
export const getEmailAssetUrl = (): string => getRequiredEnv('EMAIL_ASSET_URL');

/** Email sender address */
export const getAuthEmail = (): string => getRequiredEnv('AUTH_EMAIL');

/** Autumn billing secret key */
export const getAutumnSecretKey = (): string => getRequiredEnv('AUTUMN_SECRET_KEY');

/** Resend API key for email delivery */
export const getResendApiKey = (): string => getRequiredEnv('RESEND_API_KEY');

/** OpenRouter API key for AI support chat */
export const getOpenRouterApiKey = (): string => getRequiredEnv('OPENROUTER_API_KEY');

/** Resend webhook secret for signature verification */
export const getResendWebhookSecret = (): string => getRequiredEnv('RESEND_WEBHOOK_SECRET');

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
