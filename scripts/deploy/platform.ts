export interface PlatformContext {
	platform: 'vercel' | 'cloudflare' | 'unknown';
	environment: 'production' | 'preview' | 'development';
	deployUrl: string | null;
	gitRef: string | null;
	isPreview: boolean;
	siteUrl: string | null;
}

/**
 * Sanitize a git branch name into a valid CF Workers preview alias.
 * Rules: lowercase letters, numbers, dashes only. Must start with a letter.
 * NOTE: Duplicated in shell in .github/workflows/e2e-preview-cf.yml — keep in sync.
 */
export function sanitizeBranchAlias(branch: string): string {
	const sanitized = branch
		.toLowerCase()
		.replace(/[^a-z0-9-]/g, '-')
		.replace(/-+/g, '-')
		.replace(/^-|-$/g, '')
		.replace(/^[0-9]/, 'b-$&')
		.slice(0, 50) // DNS-aware: 63 - 1 (dash) - 12 (saas-starter) = 50
		.replace(/-$/, ''); // trim trailing dash that truncation may introduce
	return sanitized || 'branch';
}

export function detectPlatform(): PlatformContext {
	// Vercel: VERCEL is set to "1" by the platform
	if (process.env.VERCEL) {
		const env = process.env.VERCEL_ENV as 'production' | 'preview' | 'development' | undefined;
		const environment = env ?? 'development';
		const vercelUrl = process.env.VERCEL_URL ?? null;

		return {
			platform: 'vercel',
			environment,
			deployUrl: vercelUrl,
			gitRef: process.env.VERCEL_GIT_COMMIT_REF ?? null,
			isPreview: environment === 'preview',
			// Vercel provides hostname only (no protocol)
			siteUrl: vercelUrl ? `https://${vercelUrl}` : null
		};
	}

	// Cloudflare Workers (WORKERS_CI) or Pages (CF_PAGES)
	if (process.env.WORKERS_CI || process.env.CF_PAGES) {
		const branch = process.env.WORKERS_CI_BRANCH ?? process.env.CF_PAGES_BRANCH ?? null;
		const productionBranch = process.env.PRODUCTION_BRANCH || 'main';
		const isPreview = branch !== null && branch !== productionBranch;
		const environment = isPreview ? 'preview' : 'production';

		// CF_PAGES_URL is a full URL with https:// (Pages only)
		const deployUrl = process.env.CF_PAGES_URL ?? null;

		// Compute siteUrl based on platform variant
		let siteUrl: string | null = null;

		if (deployUrl) {
			// Pages: URL provided directly
			siteUrl = deployUrl;
		} else if (process.env.WORKERS_CI) {
			// Workers: construct from worker name + subdomain
			// For previews, always use constructed URL (SITE_URL is the production domain
			// and Workers Builds doesn't scope build variables by environment)
			const workerName = process.env.WORKERS_NAME;
			const subdomain = process.env.WORKERS_SUBDOMAIN;
			if (isPreview && branch && workerName && subdomain) {
				const alias = sanitizeBranchAlias(branch);
				siteUrl = `https://${alias}-${workerName}.${subdomain}.workers.dev`;
			} else if (process.env.SITE_URL) {
				// Production: prefer explicit SITE_URL (custom domain)
				siteUrl = process.env.SITE_URL;
			} else if (workerName && subdomain) {
				// Production fallback: construct from worker name
				siteUrl = `https://${workerName}.${subdomain}.workers.dev`;
			}
		} else if (process.env.SITE_URL) {
			// Pages fallback
			siteUrl = process.env.SITE_URL;
		}

		return {
			platform: 'cloudflare',
			environment,
			deployUrl,
			gitRef: branch,
			isPreview,
			siteUrl
		};
	}

	// Unknown platform: use SITE_URL from env if set
	return {
		platform: 'unknown',
		environment: 'production',
		deployUrl: null,
		gitRef: null,
		isPreview: false,
		siteUrl: process.env.SITE_URL ?? null
	};
}
