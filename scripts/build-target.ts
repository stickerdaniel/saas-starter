type BuildEnv = Partial<Record<string, string>>;

/**
 * The adapter a build uses. Workers Builds sets WORKERS_CI, which adapter-auto does not
 * recognize, so it selects adapter-cloudflare directly. NODE_ADAPTER=1 opts into
 * adapter-node for self-hosted (Coolify/Nixpacks) builds. Everything else goes through
 * adapter-auto, which picks Vercel (VERCEL) before Cloudflare Pages (CF_PAGES).
 */
export function buildAdapter(env: BuildEnv = process.env): 'cloudflare' | 'node' | 'auto' {
	if (env.WORKERS_CI) return 'cloudflare';
	if (env.NODE_ADAPTER === '1') return 'node';
	return 'auto';
}

/**
 * Whether the selected adapter deploys to Cloudflare. Those builds read their environment
 * from the Worker binding that `varlock-wrangler` uploads; every other target embeds the
 * resolved manifest in the server bundle instead.
 */
export function isCloudflareBuild(env: BuildEnv = process.env): boolean {
	const adapter = buildAdapter(env);
	return adapter === 'cloudflare' || (adapter === 'auto' && !env.VERCEL && !!env.CF_PAGES);
}
