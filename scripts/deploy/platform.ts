export interface PlatformContext {
	platform: 'vercel' | 'cloudflare' | 'unknown';
	environment: 'production' | 'preview' | 'development';
	deployUrl: string | null;
	gitRef: string | null;
	isPreview: boolean;
	siteUrl: string | null;
}

const FALLBACK_ALIAS = 'branch';

/**
 * Sanitize a git branch name into a valid CF Workers preview alias.
 * Rules: lowercase letters, numbers, dashes only. Must start with a letter.
 * Slice length is computed from the worker name so the preview hostname label
 * `${alias}-${workerName}.${subdomain}.workers.dev` stays within the 63-char DNS limit.
 * NOTE: .github/workflows/e2e-fork-preview.yml imports this function (via `bun -e`)
 * to compute the fork preview URL, so it stays the single source of truth.
 */
export function sanitizeBranchAlias(branch: string, workerName: string): string {
	const maxAliasLen = 63 - 1 - workerName.length;
	if (maxAliasLen < FALLBACK_ALIAS.length) {
		throw new Error(
			`Worker name "${workerName}" (${workerName.length} chars) leaves only ${maxAliasLen} chars for the preview alias; need at least ${FALLBACK_ALIAS.length}. Rename the worker or shorten it.`
		);
	}
	const sanitized = branch
		.toLowerCase()
		.replace(/[^a-z0-9-]/g, '-')
		.replace(/-+/g, '-')
		.replace(/^-|-$/g, '')
		.replace(/^[0-9]/, 'b-$&')
		.slice(0, maxAliasLen)
		.replace(/-$/, ''); // trim trailing dash that truncation may introduce
	return sanitized || FALLBACK_ALIAS;
}

export function detectPlatform(env: NodeJS.ProcessEnv = process.env): PlatformContext {
	// Vercel: VERCEL is set to "1" by the platform
	if (env.VERCEL) {
		const environment = env.VERCEL_ENV ?? 'development';
		if (
			environment !== 'production' &&
			environment !== 'preview' &&
			environment !== 'development'
		) {
			throw new Error('Unsupported VERCEL_ENV; expected production, preview, or development');
		}
		const vercelUrl = env.VERCEL_URL ?? null;
		// VERCEL_URL is the per-deployment generated host (changes every deploy).
		// For production builds prefer VERCEL_PROJECT_PRODUCTION_URL, the stable
		// production domain, so baked canonical/og URLs don't point at an
		// ephemeral deployment host.
		const productionUrl =
			environment === 'production' ? (env.VERCEL_PROJECT_PRODUCTION_URL ?? null) : null;
		const siteHost = productionUrl ?? vercelUrl;

		return {
			platform: 'vercel',
			environment,
			deployUrl: vercelUrl,
			gitRef: env.VERCEL_GIT_COMMIT_REF ?? null,
			isPreview: environment === 'preview',
			// Vercel provides hostnames only (no protocol)
			siteUrl: siteHost ? `https://${siteHost}` : null
		};
	}

	// Cloudflare Workers (WORKERS_CI) or Pages (CF_PAGES)
	if (env.WORKERS_CI || env.CF_PAGES) {
		const branch = env.WORKERS_CI_BRANCH ?? env.CF_PAGES_BRANCH ?? null;
		const productionBranch = env.PRODUCTION_BRANCH || 'main';
		const isPreview = branch !== null && branch !== productionBranch;
		const environment = isPreview ? 'preview' : 'production';

		// CF_PAGES_URL is a full URL with https:// (Pages only)
		const deployUrl = env.CF_PAGES_URL ?? null;

		// Compute siteUrl based on platform variant
		let siteUrl: string | null = null;

		if (deployUrl) {
			// Pages: URL provided directly
			siteUrl = deployUrl;
		} else if (env.WORKERS_CI) {
			// Workers: construct from worker name + subdomain
			// For previews, always use constructed URL (SITE_URL is the production domain
			// and Workers Builds doesn't scope build variables by environment)
			const workerName = env.WORKERS_NAME;
			const subdomain = env.WORKERS_SUBDOMAIN;
			if (isPreview && branch && workerName && subdomain) {
				const alias = sanitizeBranchAlias(branch, workerName);
				siteUrl = `https://${alias}-${workerName}.${subdomain}.workers.dev`;
			} else if (env.SITE_URL) {
				// Production: prefer explicit SITE_URL (custom domain)
				siteUrl = env.SITE_URL;
			} else if (workerName && subdomain) {
				// Production fallback: construct from worker name
				siteUrl = `https://${workerName}.${subdomain}.workers.dev`;
			}
		} else if (env.SITE_URL) {
			// Pages fallback
			siteUrl = env.SITE_URL;
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
		siteUrl: env.SITE_URL ?? null
	};
}
