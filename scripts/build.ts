import { normalizeSiteOrigin } from '../src/lib/config/origin';

const LOCAL_PREVIEW_ORIGIN = 'http://localhost:4173';

export function resolveBuildSiteOrigin(env: NodeJS.ProcessEnv): string {
	const publicOrigin = env.PUBLIC_SITE_URL ? normalizeSiteOrigin(env.PUBLIC_SITE_URL) : null;
	const compatibleOrigin = env.SITE_URL ? normalizeSiteOrigin(env.SITE_URL) : null;

	if (publicOrigin && compatibleOrigin && publicOrigin !== compatibleOrigin) {
		throw new Error(
			`PUBLIC_SITE_URL (${publicOrigin}) conflicts with SITE_URL (${compatibleOrigin}). Configure one canonical frontend origin.`
		);
	}
	if (publicOrigin || compatibleOrigin) return publicOrigin ?? compatibleOrigin!;

	if (env.NODE_ADAPTER === '1' || env.VERCEL || env.WORKERS_CI || env.CF_PAGES) {
		throw new Error(
			'PUBLIC_SITE_URL is required for hosted production builds. Use scripts/deploy.ts so the platform origin is derived before Vite runs.'
		);
	}

	// `vite preview` serves the local production build on this origin. Hosted
	// builds use scripts/deploy.ts, which always supplies the deployment origin.
	return LOCAL_PREVIEW_ORIGIN;
}

export function viteBuildCommand(args: string[]): string[] {
	return ['vite', 'build', ...args];
}

if (import.meta.main) {
	let siteOrigin: string;
	try {
		siteOrigin = resolveBuildSiteOrigin(process.env);
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exit(1);
	}

	const child = Bun.spawn(viteBuildCommand(process.argv.slice(2)), {
		stdio: ['inherit', 'inherit', 'inherit'],
		env: { ...process.env, PUBLIC_SITE_URL: siteOrigin }
	});
	process.exit((await child.exited) ?? 0);
}
