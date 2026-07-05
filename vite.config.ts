import * as childProcess from 'node:child_process';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { varlockLoadedEnv, varlockVitePlugin } from '@varlock/vite-integration';
import { convexLocal } from 'convex-vite-plugin';
import { resetRedactionMap } from 'varlock/env';
import { DEV_FEATURES, type DevFeature } from './src/lib/dev/features';
import { findAvailablePort, portlessOwnsPort } from './scripts/dev-ports';
import { TEST_ONLY_ENV_PLACEHOLDERS } from './scripts/local-convex-env';
import { sentrySvelteKit } from '@sentry/sveltekit';
import devtoolsJson from 'vite-plugin-devtools-json';
import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';
import { visualizer } from 'rollup-plugin-visualizer';
import { FontaineTransform } from 'fontaine';
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

function getPersistentBetterAuthSecret(projectDir: string, suffix?: string): string {
	const stateId = computeLocalConvexStateId(projectDir, suffix);
	const stateDir = path.join(projectDir, '.convex', stateId);
	const secretPath = path.join(stateDir, 'better-auth-secret');

	const existing = fs.existsSync(secretPath) ? fs.readFileSync(secretPath, 'utf-8').trim() : '';
	if (existing) {
		return existing;
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

	// Sentry is production-only. CF Workers Builds shares build env vars across the
	// production and preview triggers, so PUBLIC_SENTRY_DSN would otherwise bake into
	// preview/PR deploys: it loads the SDK on every public page (which destabilizes the
	// public E2E run) and reports PR errors into the prod Sentry project. Blank the
	// Sentry vars for any non-production build. Blank, not delete: PUBLIC_SENTRY_DSN is
	// imported from $env/static/public, which only exports vars present at build time,
	// so deleting it breaks that import (MISSING_EXPORT). An empty string keeps the
	// export but reads as falsy, so the SDK is still dead-code-eliminated. Mirrors the
	// prod/preview check in scripts/cf-deploy.ts (WORKERS_CI_BRANCH).
	const ciBranch = process.env.WORKERS_CI_BRANCH;
	const isProductionDeploy = !ciBranch || ciBranch === (process.env.PRODUCTION_BRANCH || 'main');
	if (!isProductionDeploy) {
		for (const key of ['PUBLIC_SENTRY_DSN', 'SENTRY_AUTH_TOKEN', 'SENTRY_ORG', 'SENTRY_PROJECT']) {
			process.env[key] = '';
			loadedEnv[key] = '';
		}
	}

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

		// Wipe the state dir HERE, not via the plugin's reset option: the plugin
		// rm's the whole dir at boot, i.e. AFTER getPersistentBetterAuthSecret
		// below has written the fresh secret file into it. The reset run itself
		// stays green (the backend keeps the secret in memory), but every
		// following run then re-rolls the secret against this run's surviving
		// JWKS rows and /api/auth/convex/token 500s with "Failed to decrypt
		// private key" until the next reset.
		if (resetLocalBackend) {
			fs.rmSync(path.join(cwd, '.convex', computeLocalConvexStateId(cwd, stateIdSuffix)), {
				recursive: true,
				force: true
			});
		}

		// Write backend URL so E2E tests (Playwright) can discover it.
		// Test mode writes to a separate file so dev's .backend-url isn't clobbered when
		// `bun run dev` and `bun run dev:test` run concurrently.
		const convexStateDir = path.join(cwd, '.convex');
		fs.mkdirSync(convexStateDir, { recursive: true });
		const backendUrlFile = isTestMode ? '.test-backend-url' : '.backend-url';
		fs.writeFileSync(path.join(convexStateDir, backendUrlFile), backendUrl);
		const betterAuthSecret =
			loadedEnv.BETTER_AUTH_SECRET?.trim() || getPersistentBetterAuthSecret(cwd, stateIdSuffix);

		// Load Convex backend env vars from .env.convex.local.
		// SITE_URL is stripped: locally it must always track the running dev server
		// (or PORTLESS_SITE_URL), and a static value copied into the file would pin
		// Better Auth's trusted origin to the wrong origin and silently break
		// sign-in. The envVars callback below derives it and warns when a stripped
		// value differed.
		const { SITE_URL: ignoredLocalSiteUrl, ...convexLocalEnv } = parseEnvFile(
			path.join(cwd, '.env.convex.local')
		);
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

		// Isolate heap knobs for the spawned local backend (inherits this env).
		// Better Auth's bundle keeps ~50 MiB resident between requests.
		// USER_HEAP (default 64 MiB) sizes the working heap and prevents OOMs;
		// EXTRA (default 32 MiB) is the carry-over allowance the restart check
		// actually uses. Without EXTRA the backend recycles the isolate after
		// nearly every UDF (TooMuchMemoryCarryOver) and each request re-imports
		// the bundle. https://github.com/get-convex/convex-backend/issues/312
		process.env.ISOLATE_MAX_USER_HEAP_SIZE ??= '134217728';
		process.env.ISOLATE_MAX_HEAP_EXTRA_SIZE ??= '134217728';

		plugins.push(
			convexLocal({
				convexDir: 'src/lib/convex',
				port: backendPort,
				siteProxyPort,
				stateIdSuffix,
				// Never let the plugin wipe the state dir itself: the reset already
				// happened above, BEFORE the better-auth secret file was written.
				reset: false,
				onReady: [{ name: 'localDev:ensureSeededAdmin' }],
				envVars: ({ vitePort, resolvedUrls }) => {
					// When portless fronts vite, resolvedUrls.local[0] is vite's own
					// localhost URL, not the .localhost named origin -- so the trustedOrigin
					// would mismatch. Use the SAME predicate as the dev/test wrappers so the
					// wrapper-bound port, Playwright baseURL, and Convex SITE_URL always agree.
					const siteUrl = portlessOwnsPort()
						? process.env.PORTLESS_SITE_URL!
						: (resolvedUrls?.local[0] ?? `http://localhost:${vitePort}`);
					if (ignoredLocalSiteUrl && ignoredLocalSiteUrl !== siteUrl) {
						console.warn(
							`[convex] Ignoring SITE_URL=${ignoredLocalSiteUrl} from .env.convex.local; ` +
								`using ${siteUrl} (derived from the running dev server) so local sign-in keeps working. ` +
								`Remove SITE_URL from .env.convex.local to silence this warning.`
						);
					}
					return {
						// Auto-generated defaults for local dev
						BETTER_AUTH_SECRET: betterAuthSecret,
						SITE_URL: siteUrl,
						LOCAL_CONVEX_DEV: 'true',
						LOCAL_SEEDED_ADMIN_EMAIL: 'admin@local.dev',
						LOCAL_SEEDED_ADMIN_PASSWORD: 'LocalDevAdmin123!',
						LOCAL_SEEDED_ADMIN_NAME: 'Local Admin',
						// Test mode: inert placeholders for the deploy-required secrets the
						// e2e suite never exercises, so a fresh test backend passes Convex's
						// push-time env validation with no real secret. See local-convex-env.ts;
						// real values in .env.convex.local override them (spread below).
						...(isTestMode ? TEST_ONLY_ENV_PLACEHOLDERS : {}),
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
		// Metric-matched fallback faces for the self-hosted Outfit, so the swap from
		// the system fallback to the real face shifts layout near zero. Fontaine
		// appends the fallback family to the web app's own font usages here; it must
		// never be written into the --font-* tokens, since the email renderer shares
		// those tokens verbatim and would otherwise carry a family no client resolves.
		FontaineTransform.vite({
			fallbacks: { Outfit: ['Arial', 'sans-serif'] },
			resolvePath: (id) => 'file://' + path.join(process.cwd(), 'static', id)
		}),
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
				'references/**',
				// Skills are symlinked into .claude/skills/; exclude the symlinked path so
				// skill tests under skills/ are not discovered and run twice.
				'.claude/skills/**'
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
				// convex-svelte (>=0.14.0), @mmailaender/convex-better-auth-svelte
				// (>=0.8.1), and @stickerdaniel/convex-autumn-svelte (>=0.3.0) all ship a
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
