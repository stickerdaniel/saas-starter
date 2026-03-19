import * as childProcess from 'node:child_process';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as net from 'node:net';
import * as path from 'node:path';
import { varlockVitePlugin } from '@varlock/vite-integration';
import { convexLocal } from 'convex-vite-plugin';
import devtoolsJson from 'vite-plugin-devtools-json';
import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';
import { visualizer } from 'rollup-plugin-visualizer';
import { loadEnv, type PluginOption } from 'vite';

async function isPortAvailable(port: number): Promise<boolean> {
	return await new Promise((resolve) => {
		const server = net.createServer();
		server.unref();
		server.once('error', () => {
			resolve(false);
		});
		server.listen(port, '127.0.0.1', () => {
			server.close(() => resolve(true));
		});
	});
}

async function findAvailablePort(startPort: number, maxAttempts = 100): Promise<number> {
	for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
		const port = startPort + attempt;
		if (await isPortAvailable(port)) {
			return port;
		}
	}

	throw new Error(`Could not find an available port after ${maxAttempts} attempts`);
}

function computeLocalConvexStateId(projectDir: string, suffix?: string): string {
	let gitBranch = 'unknown';
	try {
		const result = childProcess.spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
			cwd: projectDir,
			encoding: 'utf-8',
			stdio: ['ignore', 'pipe', 'pipe']
		});
		if (result.status === 0 && result.stdout) {
			gitBranch = result.stdout.trim();
		}
	} catch {
		// Ignore git errors and fall back to a stable "unknown" branch marker.
	}

	const input = suffix ? `${gitBranch}:${projectDir}:${suffix}` : `${gitBranch}:${projectDir}`;
	const hash = crypto.createHash('sha256').update(input).digest('hex').slice(0, 16);
	const sanitizedBranch = gitBranch.replace(/[^a-zA-Z0-9-]/g, '-');
	const sanitizedSuffix = suffix ? `-${suffix.replace(/[^a-zA-Z0-9-]/g, '-')}` : '';
	return `${sanitizedBranch}${sanitizedSuffix}-${hash}`;
}

function getPersistentBetterAuthSecret(projectDir: string, reset: boolean): string {
	const stateId = computeLocalConvexStateId(projectDir);
	const stateDir = path.join(projectDir, '.convex', stateId);
	const secretPath = path.join(stateDir, 'better-auth-secret');

	if (!reset) {
		const existing = fs.existsSync(secretPath) ? fs.readFileSync(secretPath, 'utf-8').trim() : '';
		if (existing) {
			return existing;
		}
	}

	const secret = crypto.randomBytes(32).toString('hex');
	fs.mkdirSync(stateDir, { recursive: true });
	fs.writeFileSync(secretPath, `${secret}\n`);
	return secret;
}

function addOptionalEnv(
	envVars: Record<string, string>,
	key: string,
	value: string | undefined
): void {
	const trimmed = value?.trim();
	if (trimmed) {
		envVars[key] = trimmed;
	}
}

export default defineConfig(async ({ mode }) => {
	const cwd = process.cwd();
	const loadedEnv = loadEnv(mode, cwd, '');
	const useLocalConvex = (process.env.USE_LOCAL_CONVEX ?? loadedEnv.USE_LOCAL_CONVEX) === 'true';
	const plugins: PluginOption[] = [];

	if (useLocalConvex) {
		const backendPort = await findAvailablePort(Math.floor(Math.random() * 10_000) + 3210);
		const siteProxyPort = await findAvailablePort(backendPort + 1);
		const backendUrl = `http://localhost:${backendPort}`;
		const siteProxyUrl = `http://localhost:${siteProxyPort}`;
		const missingEmailEnv = ['RESEND_API_KEY', 'AUTH_EMAIL'].filter(
			(key) => !loadedEnv[key]?.trim()
		);
		const resetLocalBackend =
			(process.env.RESET_LOCAL_BACKEND ?? loadedEnv.RESET_LOCAL_BACKEND) === 'true';
		const betterAuthSecret =
			loadedEnv.BETTER_AUTH_SECRET?.trim() || getPersistentBetterAuthSecret(cwd, resetLocalBackend);

		if (missingEmailEnv.length > 0) {
			console.warn(
				`[dev:local] Missing ${missingEmailEnv.join(', ')} in .env.local. ` +
					'Local boot will use the seeded admin account, but manual signup, verification, and password reset emails will not work until these are configured.'
			);
		}

		process.env.PUBLIC_CONVEX_URL = backendUrl;
		process.env.PUBLIC_CONVEX_SITE_URL = siteProxyUrl;

		plugins.push(
			convexLocal({
				convexDir: 'src/lib/convex',
				port: backendPort,
				siteProxyPort,
				reset: resetLocalBackend,
				onReady: [{ name: 'localDev:ensureSeededAdmin' }],
				envVars: ({ vitePort, resolvedUrls }) => {
					const siteUrl = resolvedUrls?.local[0] ?? `http://localhost:${vitePort}`;
					const envVars: Record<string, string> = {
						BETTER_AUTH_SECRET: betterAuthSecret,
						SITE_URL: siteUrl,
						EMAIL_ASSET_URL: siteUrl,
						LOCAL_CONVEX_DEV: 'true',
						LOCAL_SEEDED_ADMIN_EMAIL: 'admin@local.dev',
						LOCAL_SEEDED_ADMIN_PASSWORD: 'LocalDevAdmin123!',
						LOCAL_SEEDED_ADMIN_NAME: 'Local Admin'
					};

					addOptionalEnv(envVars, 'RESEND_API_KEY', loadedEnv.RESEND_API_KEY);
					addOptionalEnv(envVars, 'AUTH_EMAIL', loadedEnv.AUTH_EMAIL);
					addOptionalEnv(envVars, 'AUTH_GOOGLE_ID', loadedEnv.AUTH_GOOGLE_ID);
					addOptionalEnv(envVars, 'AUTH_GOOGLE_SECRET', loadedEnv.AUTH_GOOGLE_SECRET);
					addOptionalEnv(envVars, 'AUTH_GITHUB_ID', loadedEnv.AUTH_GITHUB_ID);
					addOptionalEnv(envVars, 'AUTH_GITHUB_SECRET', loadedEnv.AUTH_GITHUB_SECRET);
					addOptionalEnv(envVars, 'OPENROUTER_API_KEY', loadedEnv.OPENROUTER_API_KEY);
					addOptionalEnv(envVars, 'AUTUMN_SECRET_KEY', loadedEnv.AUTUMN_SECRET_KEY);
					addOptionalEnv(envVars, 'AUTH_E2E_TEST_SECRET', loadedEnv.AUTH_E2E_TEST_SECRET);

					return envVars;
				}
			})
		);
	}

	plugins.push(
		varlockVitePlugin({ ssrInjectMode: 'resolved-env' }),
		tailwindcss(),
		sveltekit(),
		devtoolsJson(),
		// Bundle analyzer
		visualizer({
			emitFile: true,
			filename: 'stats.html',
			template: 'treemap',
			gzipSize: true,
			brotliSize: true
		}) as PluginOption
	);

	return {
		plugins: plugins as any,
		resolve: {
			conditions: ['browser']
		},
		test: {
			exclude: [
				'e2e/**',
				'**/node_modules/**',
				'dist/**',
				'.{idea,git,cache,output,temp}/**',
				'docs/**',
				'.opencode/**',
				'references/**'
			],
			passWithNoTests: true,
			environment: 'jsdom'
		},
		optimizeDeps: {
			include: ['svelte-konva', 'konva']
		},
		ssr: {
			noExternal: ['svelte-konva']
		}
	};
});
