export interface PlatformContext {
	platform: 'vercel' | 'cloudflare' | 'unknown';
	environment: 'production' | 'preview' | 'development';
	deployUrl: string | null;
	gitRef: string | null;
	isPreview: boolean;
	siteUrl: string | null;
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

	// Cloudflare Pages: CF_PAGES is set to "1" by the platform
	if (process.env.CF_PAGES) {
		const branch = process.env.CF_PAGES_BRANCH ?? null;
		const productionBranch = process.env.PRODUCTION_BRANCH || 'main';
		const isPreview = branch !== null && branch !== productionBranch;
		const environment = isPreview ? 'preview' : 'production';
		// CF_PAGES_URL is a full URL with https:// (confirmed by CF docs)
		const cfPagesUrl = process.env.CF_PAGES_URL ?? null;

		return {
			platform: 'cloudflare',
			environment,
			deployUrl: cfPagesUrl,
			gitRef: branch,
			isPreview,
			// CF provides full URL, use directly
			siteUrl: cfPagesUrl
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
