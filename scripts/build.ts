import { loadEnv } from 'vite';
import { normalizeSiteOrigin } from '../src/lib/config/origin';

const LOCAL_PREVIEW_ORIGIN = 'http://localhost:4173';

export function viteBuildMode(args: string[]): string {
	let mode = 'production';
	for (let index = 0; index < args.length; index += 1) {
		const argument = args[index]!;
		if ((argument === '--mode' || argument === '-m') && args[index + 1]) {
			mode = args[index + 1]!;
			index += 1;
		} else if (argument.startsWith('--mode=') || argument.startsWith('-m=')) {
			mode = argument.slice(argument.indexOf('=') + 1) || mode;
		}
	}
	return mode;
}

export function loadBuildEnvironment(
	args: string[],
	processEnvironment: NodeJS.ProcessEnv,
	cwd = process.cwd()
): NodeJS.ProcessEnv {
	return { ...loadEnv(viteBuildMode(args), cwd, ''), ...processEnvironment };
}

export function resolveBuildSiteOrigin(env: NodeJS.ProcessEnv): string {
	const publicOrigin = env.PUBLIC_SITE_URL ? normalizeSiteOrigin(env.PUBLIC_SITE_URL) : null;
	const compatibleOrigin = env.SITE_URL ? normalizeSiteOrigin(env.SITE_URL) : null;

	if (publicOrigin && compatibleOrigin && publicOrigin !== compatibleOrigin) {
		throw new Error(
			`PUBLIC_SITE_URL (${publicOrigin}) conflicts with SITE_URL (${compatibleOrigin}). Configure one canonical frontend origin.`
		);
	}
	if (publicOrigin || compatibleOrigin) return publicOrigin ?? compatibleOrigin!;

	const adapterAutoHost =
		env.VERCEL ||
		env.CF_PAGES ||
		env.NETLIFY ||
		env.GITHUB_ACTION_REPOSITORY === 'Azure/static-web-apps-deploy' ||
		env.SST ||
		env.GCP_BUILDPACKS;
	if (env.NODE_ADAPTER === '1' || env.WORKERS_CI || adapterAutoHost) {
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
	const args = process.argv.slice(2);
	const buildEnvironment = loadBuildEnvironment(args, process.env);
	let siteOrigin: string;
	try {
		siteOrigin = resolveBuildSiteOrigin(buildEnvironment);
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exit(1);
	}

	const child = Bun.spawn(viteBuildCommand(args), {
		stdio: ['inherit', 'inherit', 'inherit'],
		env: { ...buildEnvironment, PUBLIC_SITE_URL: siteOrigin }
	});
	process.exit((await child.exited) ?? 0);
}
