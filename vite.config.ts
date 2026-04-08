import * as childProcess from 'node:child_process';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as net from 'node:net';
import * as path from 'node:path';
import { varlockLoadedEnv, varlockVitePlugin } from '@varlock/vite-integration';
import { convexLocal } from 'convex-vite-plugin';
import { resetRedactionMap } from 'varlock/env';
import { sentrySvelteKit } from '@sentry/sveltekit';
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

/**
 * Parse a dotenv-style file into a Record<string, string>.
 * Skips blank lines and comments. Does not expand variables.
 */
function parseEnvFile(filePath: string): Record<string, string> {
	if (!fs.existsSync(filePath)) return {};
	const vars: Record<string, string> = {};
	for (const line of fs.readFileSync(filePath, 'utf-8').split('\n')) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith('#')) continue;
		// Strip optional leading `export`
		const effective = trimmed.startsWith('export ') ? trimmed.slice(7).trim() : trimmed;
		const eqIndex = effective.indexOf('=');
		if (eqIndex === -1) continue;
		const key = effective.slice(0, eqIndex).trim();
		let value = effective.slice(eqIndex + 1).trim();
		// Strip inline comment (only outside of quotes)
		if (!value.startsWith('"') && !value.startsWith("'")) {
			const hashIndex = value.indexOf(' #');
			if (hashIndex !== -1) value = value.slice(0, hashIndex).trim();
		}
		// Strip surrounding quotes
		if (
			(value.startsWith('"') && value.endsWith('"')) ||
			(value.startsWith("'") && value.endsWith("'"))
		) {
			value = value.slice(1, -1);
		}
		if (key && value) {
			vars[key] = value;
		}
	}
	return vars;
}

/**
 * Parse a varlock .env schema and return var names marked @sensitive.
 * Also handles @defaultSensitive=inferFromPrefix(PREFIX_) — vars without
 * the prefix are treated as sensitive by default.
 */
function parseSensitiveVarNames(schemaPath: string): Set<string> {
	if (!fs.existsSync(schemaPath)) return new Set();
	const lines = fs.readFileSync(schemaPath, 'utf-8').split('\n');

	let publicPrefix: string | undefined;
	for (const line of lines) {
		const match = line.match(/^#\s*@defaultSensitive=inferFromPrefix\((\w+)\)/);
		if (match?.[1]) {
			publicPrefix = match[1];
			break;
		}
		if (line.trim() === '# ---') break;
	}

	const sensitiveNames = new Set<string>();
	let nextIsSensitive: boolean | undefined;

	for (const line of lines) {
		const trimmed = line.trim();
		if (trimmed.startsWith('#')) {
			if (trimmed.includes('@sensitive')) nextIsSensitive = true;
			continue;
		}

		const effective = trimmed.startsWith('export ') ? trimmed.slice(7).trim() : trimmed;
		const eqIndex = effective.indexOf('=');
		if (eqIndex === -1) {
			nextIsSensitive = undefined;
			continue;
		}
		const key = effective.slice(0, eqIndex).trim();
		if (!key) {
			nextIsSensitive = undefined;
			continue;
		}

		if (nextIsSensitive === true) {
			sensitiveNames.add(key);
		} else if (nextIsSensitive === undefined && publicPrefix && !key.startsWith(publicPrefix)) {
			sensitiveNames.add(key);
		}
		nextIsSensitive = undefined;
	}

	return sensitiveNames;
}

export default defineConfig(async ({ mode }) => {
	const cwd = process.cwd();
	const loadedEnv = loadEnv(mode, cwd, '');
	// Local Convex backend only during `bun run dev` (not CI, builds, postinstall, or scripts).
	// build:emails uses createServer() which re-enters this config -- lifecycle check prevents that.
	// dev:cloud runs via dev:frontend (lifecycle = "dev:frontend"), so it's excluded naturally.
	const useLocalConvex = process.env.npm_lifecycle_event === 'dev' && !process.env.CI;
	const plugins: PluginOption[] = [];

	if (useLocalConvex) {
		const backendPort = await findAvailablePort(Math.floor(Math.random() * 10_000) + 3210);
		const siteProxyPort = await findAvailablePort(backendPort + 1);
		const backendUrl = `http://localhost:${backendPort}`;
		const siteProxyUrl = `http://localhost:${siteProxyPort}`;
		const resetLocalBackend = process.env.RESET_LOCAL_BACKEND === 'true';

		// Write backend URL so E2E tests (Playwright) can discover it
		const convexStateDir = path.join(cwd, '.convex');
		fs.mkdirSync(convexStateDir, { recursive: true });
		fs.writeFileSync(path.join(convexStateDir, '.backend-url'), backendUrl);
		const betterAuthSecret =
			loadedEnv.BETTER_AUTH_SECRET?.trim() || getPersistentBetterAuthSecret(cwd, resetLocalBackend);

		// Load Convex backend env vars from .env.convex.local
		const convexLocalEnv = parseEnvFile(path.join(cwd, '.env.convex.local'));
		// Register Convex backend env values with varlock's redaction map so that
		// convex-vite-plugin's env-var logging is automatically redacted.
		// varlockLoadedEnv already contains .env.schema values; we merge in
		// the Convex backend values marked @sensitive in .env-convex.schema.
		const convexSensitiveNames = parseSensitiveVarNames(path.join(cwd, '.env-convex.schema'));
		convexSensitiveNames.add('BETTER_AUTH_SECRET');

		const mergedConfig: Record<string, { value: any; isSensitive: boolean }> = {
			...varlockLoadedEnv?.config
		};

		const allConvexEnvVars: Record<string, string> = {
			BETTER_AUTH_SECRET: betterAuthSecret,
			LOCAL_SEEDED_ADMIN_PASSWORD: 'LocalDevAdmin123!',
			...convexLocalEnv
		};

		for (const [key, value] of Object.entries(allConvexEnvVars)) {
			if (!value) continue;
			const existing = mergedConfig[key];
			if (!existing || !existing.value) {
				mergedConfig[key] = { value, isSensitive: convexSensitiveNames.has(key) };
			}
		}

		resetRedactionMap({
			settings: { redactLogs: true },
			sources: varlockLoadedEnv?.sources ?? [],
			config: mergedConfig
		});

		const missingEmailEnv = ['RESEND_API_KEY', 'AUTH_EMAIL'].filter(
			(key) => !convexLocalEnv[key]?.trim()
		);

		if (missingEmailEnv.length > 0) {
			console.warn(
				`[dev] Missing ${missingEmailEnv.join(', ')} in .env.convex.local. ` +
					'Local boot will use the seeded admin account, but manual signup, verification, and password reset emails will not work until these are configured.'
			);
		}

		process.env.PUBLIC_CONVEX_URL = backendUrl;
		process.env.PUBLIC_CONVEX_SITE_URL = siteProxyUrl;

		// Raise V8 isolate heap limit to 128 MiB (default 64 MiB).
		// Better Auth's bundle uses ~50 MiB, leaving too little room at the default.
		// https://github.com/get-convex/convex-backend/issues/312
		process.env.ISOLATE_MAX_USER_HEAP_SIZE ??= '134217728';

		plugins.push(
			convexLocal({
				convexDir: 'src/lib/convex',
				port: backendPort,
				siteProxyPort,
				reset: resetLocalBackend,
				onReady: [{ name: 'localDev:ensureSeededAdmin' }],
				envVars: ({ vitePort, resolvedUrls }) => {
					const siteUrl = resolvedUrls?.local[0] ?? `http://localhost:${vitePort}`;
					return {
						// Auto-generated defaults for local dev
						BETTER_AUTH_SECRET: betterAuthSecret,
						SITE_URL: siteUrl,
						LOCAL_CONVEX_DEV: 'true',
						LOCAL_SEEDED_ADMIN_EMAIL: 'admin@local.dev',
						LOCAL_SEEDED_ADMIN_PASSWORD: 'LocalDevAdmin123!',
						LOCAL_SEEDED_ADMIN_NAME: 'Local Admin',
						// User overrides from .env.convex.local (takes precedence)
						...convexLocalEnv
					};
				}
			})
		);
	}

	// Ensure PUBLIC_CONVEX_URL is set for production builds so prerendering can
	// initialize the auth/Convex providers (they validate the URL at import time).
	// The actual value doesn't matter for prerendered pages — they render as
	// unauthenticated and the Convex client is never used. In CI, the real URL
	// is provided as a build secret.
	if (mode === 'production' && !process.env.PUBLIC_CONVEX_URL) {
		if (!process.env.CI && !process.env.WORKERS_CI) {
			console.warn(
				'[vite] PUBLIC_CONVEX_URL is not set. Using placeholder for prerendering. ' +
					'Set PUBLIC_CONVEX_URL in .env.local for production builds.'
			);
		}
		process.env.PUBLIC_CONVEX_URL = 'https://prerender-placeholder.convex.cloud';
	}

	// Sentry source map upload + auto-instrumentation (no-op when DSN is absent)
	if (loadedEnv.PUBLIC_SENTRY_DSN) {
		plugins.push(
			...(await sentrySvelteKit({
				autoUploadSourceMaps: !!(
					loadedEnv.SENTRY_AUTH_TOKEN &&
					loadedEnv.SENTRY_ORG &&
					loadedEnv.SENTRY_PROJECT
				)
			}))
		);
	}

	plugins.push(
		varlockVitePlugin(mode === 'production' ? { ssrInjectMode: 'resolved-env' } : {}),
		tailwindcss(),
		sveltekit(),
		devtoolsJson(),
		// Bundle analyzer
		...(process.env.ANALYZE === 'true'
			? [
					visualizer({
						emitFile: true,
						filename: 'stats.html',
						template: 'treemap',
						gzipSize: true,
						brotliSize: true
					}) as PluginOption
				]
			: [])
	);

	return {
		plugins: plugins as any,
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
			noExternal: ['svelte-konva', '@tolgee/web'],
			...(mode === 'production' && {
				resolve: {
					conditions: ['production', 'import', 'module', 'default']
				}
			})
		}
	};
});
