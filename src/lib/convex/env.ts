/**
 * Centralized Environment Variable Access
 *
 * Build-time validation: vercel-deploy.sh checks all required vars before deploy
 * Runtime validation: Getters throw if var is missing (safety net for local dev)
 *
 * Auth vars (BETTER_AUTH_SECRET, SITE_URL) have placeholders to allow Convex
 * module analysis to pass during bundling.
 */

// =============================================================================
// REQUIRED VARIABLES - Single source of truth (used by vercel-deploy.sh)
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

const AUTH_PLACEHOLDERS = {
	BETTER_AUTH_SECRET: 'placeholder-secret-for-analysis',
	SITE_URL: 'https://placeholder.invalid'
} as const;

// =============================================================================
// RUNTIME GETTERS - Throw if var missing (safety net for local dev)
// =============================================================================

/** Helper to get env var or throw with helpful message */
function getRequiredEnv(name: string, placeholder?: string): string {
	const value = process.env[name];

	// Use placeholder during Convex module analysis
	if (!value && placeholder) return placeholder;

	if (!value) {
		throw new Error(
			`Missing required environment variable: ${name}\n` +
				`Set via: bunx convex env set ${name} <value>`
		);
	}

	return value;
}

/** Authentication secret for signing sessions */
export const getBetterAuthSecret = () =>
	getRequiredEnv('BETTER_AUTH_SECRET', AUTH_PLACEHOLDERS.BETTER_AUTH_SECRET);

/** Site URL for OAuth redirects and email deep links */
export const getSiteUrl = () =>
	process.env.SITE_URL || process.env.PUBLIC_SITE_URL || AUTH_PLACEHOLDERS.SITE_URL;

/** Email asset URL for images */
export const getEmailAssetUrl = () => getRequiredEnv('EMAIL_ASSET_URL');

/** Email sender address */
export const getAuthEmail = () => getRequiredEnv('AUTH_EMAIL');

/** Autumn billing secret key */
export const getAutumnSecretKey = () => getRequiredEnv('AUTUMN_SECRET_KEY');

/** Resend API key for email delivery */
export const getResendApiKey = () => getRequiredEnv('RESEND_API_KEY');

/** OpenRouter API key for AI support chat */
export const getOpenRouterApiKey = () => getRequiredEnv('OPENROUTER_API_KEY');

/** Resend webhook secret for signature verification */
export const getResendWebhookSecret = () => getRequiredEnv('RESEND_WEBHOOK_SECRET');

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

// =============================================================================
// BUILD-TIME VALIDATION - Called by vercel-deploy.sh before deploy
// Usage: bun src/lib/convex/env.ts --validate [--prod]
// =============================================================================

function validateConvexEnv() {
	// Dynamic import to avoid bundling issues - only runs when called directly
	// eslint-disable-next-line @typescript-eslint/no-require-imports
	const { execSync } = require('child_process') as typeof import('child_process');

	const isProd = process.argv.includes('--prod');
	const cmd = `bunx convex env list${isProd ? ' --prod' : ''}`;

	let output: string;
	try {
		output = execSync(cmd, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
	} catch (error) {
		console.error('Failed to list Convex env vars:', (error as Error).message);
		process.exit(1);
	}

	// Parse "NAME=value" lines
	const existingVars = new Set(
		output
			.split('\n')
			.map((line) => line.match(/^(\w+)=/)?.[1])
			.filter(Boolean)
	);

	const missingVars = REQUIRED_VAR_NAMES.filter((name) => !existingVars.has(name));

	if (missingVars.length > 0) {
		console.error('');
		console.error('============================================================');
		console.error('❌ MISSING REQUIRED CONVEX ENVIRONMENT VARIABLES');
		console.error('============================================================');
		console.error('');
		console.error('The following variables are not set in your Convex environment:');
		for (const name of missingVars) {
			console.error(`  - ${name}`);
		}
		console.error('');
		console.error('Set them via CLI:');
		console.error(`  bunx convex env set VARIABLE_NAME value${isProd ? ' --prod' : ''}`);
		console.error('');
		console.error('Or set in Convex Dashboard:');
		console.error(
			'  https://dashboard.convex.dev → Your Project → Settings → Environment Variables'
		);
		console.error('');
		console.error('============================================================');
		process.exit(1);
	}

	console.log('✅ All required Convex environment variables are set');
}

// Run validation if called directly with --validate flag
if (process.argv.includes('--validate')) {
	validateConvexEnv();
}
