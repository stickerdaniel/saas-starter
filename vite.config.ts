import * as childProcess from 'node:child_process';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { varlockLoadedEnv, varlockVitePlugin } from '@varlock/vite-integration';
import { convexLocal } from 'convex-vite-plugin';
import { resetRedactionMap } from 'varlock/env';
import { DEV_FEATURES, type DevFeature } from './src/lib/dev/features';
import { findAvailablePort, portlessOwnsPort } from './scripts/dev-ports';
import { sentrySvelteKit } from '@sentry/sveltekit';
import devtoolsJson from 'vite-plugin-devtools-json';
import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';
import { visualizer } from 'rollup-plugin-visualizer';
import { loadEnv, type PluginOption } from 'vite';

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

function getPersistentBetterAuthSecret(
	projectDir: string,
	reset: boolean,
	suffix?: string
): string {
	const stateId = computeLocalConvexStateId(projectDir, suffix);
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
 * Parse a varlock .env schema and return var names treated as sensitive.
 * Handles @defaultSensitive=inferFromPrefix(PREFIX_): vars without the prefix
 * are sensitive by default. An explicit @public comment opts a var back out,
 * matching varlock's own classification.
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
			else if (trimmed.includes('@public')) nextIsSensitive = false;
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

/**
 * Print a boot-time banner showing which optional features are active vs
 * gated by missing env vars. Source of truth is `src/lib/dev/features.ts`
 * (also consumed by the in-context devNotice helper).
 *
 * Skipped in CI, on build, and during E2E (callers gate this).
 */
function printOptionalFeatureBanner(opts: {
	convexEnv: Record<string, string>;
	viteEnv: Record<string, string>;
}): void {
	const isSet = (feature: DevFeature) => {
		const source = feature.scope === 'convex' ? opts.convexEnv : opts.viteEnv;
		return feature.missing.every((key) => source[key]?.trim());
	};

	const rows = DEV_FEATURES.map((feature) => {
		const active = isSet(feature);
		const status = active ? '✓' : '⚠';
		const hint = active ? feature.missing.join(', ') : `set ${feature.missing.join(', ')}`;
		return { status, name: feature.name, hint };
	});

	const nameWidth = Math.max(...rows.map((r) => r.name.length));

	const lines: string[] = [];
	lines.push('');
	lines.push('  Optional features (local dev)');
	for (const row of rows) {
		lines.push(`    ${row.status}  ${row.name.padEnd(nameWidth)}  ${row.hint}`);
	}
	lines.push('');
	lines.push('  Reference: .env.convex.example, .env.schema');
	lines.push('');
	console.warn(lines.join('\n'));
}

export default defineConfig(async ({ mode }) => {
	const cwd = process.cwd();
	const loadedEnv = loadEnv(mode, cwd, '');
	// Local Convex backend during `bun run dev` and `bun run dev:test` (not CI, builds, postinstall, or scripts).
	// build:emails uses createServer() which re-enters this config -- lifecycle check prevents that.
	// dev:cloud runs via dev:frontend (lifecycle = "dev:frontend"), so it's excluded naturally.
	const lifecycle = process.env.npm_lifecycle_event;
	const useLocalConvex = (lifecycle === 'dev' || lifecycle === 'dev:test') && !process.env.CI;
	const isTestMode = lifecycle === 'dev:test';
	const stateIdSuffix = isTestMode ? 'e2e' : undefined;
	const plugins: PluginOption[] = [];

	if (useLocalConvex) {
		const backendPort = await findAvailablePort(Math.floor(Math.random() * 10_000) + 3210);
		const siteProxyPort = await findAvailablePort(backendPort + 1);
		const backendUrl = `http://localhost:${backendPort}`;
		const siteProxyUrl = `http://localhost:${siteProxyPort}`;
		const resetLocalBackend = process.env.RESET_LOCAL_BACKEND === 'true';

		// Write backend URL so E2E tests (Playwright) can discover it.
		// Test mode writes to a separate file so dev's .backend-url isn't clobbered when
		// `bun run dev` and `bun run dev:test` run concurrently.
		const convexStateDir = path.join(cwd, '.convex');
		fs.mkdirSync(convexStateDir, { recursive: true });
		const backendUrlFile = isTestMode ? '.test-backend-url' : '.backend-url';
		fs.writeFileSync(path.join(convexStateDir, backendUrlFile), backendUrl);
		const betterAuthSecret =
			loadedEnv.BETTER_AUTH_SECRET?.trim() ||
			getPersistentBetterAuthSecret(cwd, resetLocalBackend, stateIdSuffix);

		// Load Convex backend env vars from .env.convex.local
		const convexLocalEnv = parseEnvFile(path.join(cwd, '.env.convex.local'));
		// Register Convex backend env values with varlock's redaction map so that
		// convex-vite-plugin's env-var logging is automatically redacted.
		// varlockLoadedEnv already contains .env.schema values; we merge in
		// the Convex backend values marked @sensitive in .env-convex.schema.
		const convexSensitiveNames = parseSensitiveVarNames(path.join(cwd, '.env-convex.schema'));
		convexSensitiveNames.add('BETTER_AUTH_SECRET');
		convexSensitiveNames.add('AUTH_E2E_TEST_SECRET');

		const mergedConfig: Record<string, { value: any; isSensitive: boolean }> = {
			...varlockLoadedEnv?.config
		};

		const allConvexEnvVars: Record<string, string> = {
			BETTER_AUTH_SECRET: betterAuthSecret,
			LOCAL_SEEDED_ADMIN_PASSWORD: 'LocalDevAdmin123!',
			...convexLocalEnv,
			...(isTestMode && process.env.AUTH_E2E_TEST_SECRET
				? { AUTH_E2E_TEST_SECRET: process.env.AUTH_E2E_TEST_SECRET }
				: {})
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

		if (!isTestMode && !process.env.WORKERS_CI) {
			printOptionalFeatureBanner({
				convexEnv: convexLocalEnv,
				viteEnv: loadedEnv
			});
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
				stateIdSuffix,
				reset: resetLocalBackend,
				onReady: [{ name: 'localDev:ensureSeededAdmin' }],
				envVars: ({ vitePort, resolvedUrls }) => {
					// When portless fronts vite, resolvedUrls.local[0] is vite's own
					// localhost URL, not the .localhost named origin -- so the trustedOrigin
					// would mismatch. Use the SAME predicate as the dev/test wrappers so the
					// wrapper-bound port, Playwright baseURL, and Convex SITE_URL always agree.
					const siteUrl = portlessOwnsPort()
						? process.env.PORTLESS_SITE_URL!
						: (resolvedUrls?.local[0] ?? `http://localhost:${vitePort}`);
					return {
						// Auto-generated defaults for local dev
						BETTER_AUTH_SECRET: betterAuthSecret,
						SITE_URL: siteUrl,
						LOCAL_CONVEX_DEV: 'true',
						LOCAL_SEEDED_ADMIN_EMAIL: 'admin@local.dev',
						LOCAL_SEEDED_ADMIN_PASSWORD: 'LocalDevAdmin123!',
						LOCAL_SEEDED_ADMIN_NAME: 'Local Admin',
						// User overrides from .env.convex.local (takes precedence)
						...convexLocalEnv,
						// Test mode: forward AUTH_E2E_TEST_SECRET so api.tests.* mutations
						// authorize correctly. Source: process.env loaded from .env.test by varlock.
						...(isTestMode && process.env.AUTH_E2E_TEST_SECRET
							? { AUTH_E2E_TEST_SECRET: process.env.AUTH_E2E_TEST_SECRET }
							: {})
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
			noExternal: [
				'svelte-konva',
				'@tolgee/web',
				// @mmailaender/convex-svelte (>=0.18.0), @mmailaender/convex-better-auth-svelte
				// (>=0.7.4), and @stickerdaniel/convex-autumn-svelte (>=0.2.0) all ship a
				// top-level `"svelte"` field, so SvelteKit auto-bundles them.
				// WASM image codec used by the image-processing worker. Bundling avoids
				// SSR-time `import 'svelte'`-style hazards if the package adds main-thread
				// surfaces in the future; the worker chunk still keeps the WASM payload out
				// of the client entry.
				'@jsquash/webp'
			],
			...(mode === 'production' && {
				resolve: {
					conditions: ['production', 'import', 'module', 'default']
				}
			})
		}
	};
});
