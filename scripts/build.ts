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

	if (env.NODE_ADAPTER === '1') {
		throw new Error(
			'PUBLIC_SITE_URL is required for adapter-node production builds. Set it to the public frontend origin.'
		);
	}

	// `vite preview` serves the local production build on this origin. Hosted
	// builds use scripts/deploy.ts, which always supplies the deployment origin.
	return LOCAL_PREVIEW_ORIGIN;
}

if (process.argv[1] && import.meta.path === process.argv[1]) {
	let siteOrigin: string;
	try {
		siteOrigin = resolveBuildSiteOrigin(process.env);
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exit(1);
	}

	const child = Bun.spawn(['vite', 'build'], {
		stdio: ['inherit', 'inherit', 'inherit'],
		env: { ...process.env, PUBLIC_SITE_URL: siteOrigin }
	});
	process.exit((await child.exited) ?? 0);
}
