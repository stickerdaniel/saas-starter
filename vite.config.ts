import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import auto from '@sveltejs/adapter-auto';
import cloudflare from '@sveltejs/adapter-cloudflare';
import node from '@sveltejs/adapter-node';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import { CLOUDFLARE_SSR_ENTRY_CODE } from '@varlock/cloudflare-integration/ssr-entry-code';
import { varlockLoadedEnv, varlockVitePlugin } from '@varlock/vite-integration';
import { convexLocal } from 'convex-vite-plugin';
import { DEV_FEATURES, type DevFeature } from './src/lib/dev/features';
import { variables as envVariables } from './src/env.ts';
import { buildContentSecurityPolicy } from './src/lib/security/csp.js';
import { appVersion } from './scripts/app-version';
import { buildAdapter, isCloudflareBuild } from './scripts/build-target';
import { findAvailablePort, portlessOwnsPort } from './scripts/dev-ports';
import {
	computeLocalConvexStateId,
	getManagedProviderUpdates,
	localConvexMode,
	logSafeOrigin
} from './scripts/local-convex-env';
import { prepareEmbeddedEnvManifest } from './scripts/strip-varlock-secrets';
import { clearTestBackendExit, recordTestBackendExit } from './scripts/test-backend-exit';
import { thirdPartyLicenses } from './scripts/third-party-licenses/index';
import {
	OUTFIT_FONT,
	OUTFIT_UNICODE_RANGE,
	OUTFIT_WEIGHTS,
	marketingFonts
} from './scripts/marketing-fonts';
import { kitGeneratedHmr } from './scripts/kit-generated-hmr';
import { INLINE_STYLE_THRESHOLD } from './scripts/inline-styles';
import { sharedTestSettings, toolingTestSettings } from './scripts/vitest-settings.ts';
import { HeavySuiteSequencer } from './scripts/vitest-sequencer.ts';
import { sentrySvelteKit } from '@sentry/sveltekit/vite';
import devtoolsJson from 'vite-plugin-devtools-json';
import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { configDefaults, defineConfig } from 'vitest/config';
import { visualizer } from 'rollup-plugin-visualizer';
import { fontless } from 'fontless';
import { loadEnv, normalizePath, type PluginOption } from 'vite';
import { emptyCssSources } from './scripts/css-sources.ts';
import { MODULE_GRAPH_FILE, moduleGraph } from './scripts/module-graph-plugin.ts';

const featureCatalog = normalizePath(path.join(import.meta.dirname, 'src/lib/dev/features.ts'));
const stylesheet = path.join(import.meta.dirname, 'src/routes/layout.css');
const missingCssSources = emptyCssSources(stylesheet, fs.readFileSync(stylesheet, 'utf8'));
if (missingCssSources.length > 0) throw new Error(missingCssSources.join('\n'));

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

/** Skips blank lines and comments. Does not expand variables. */
function parseEnvFile(filePath: string): Record<string, string> {
	if (!fs.existsSync(filePath)) return {};
	const vars: Record<string, string> = {};
	for (const line of fs.readFileSync(filePath, 'utf-8').split('\n')) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith('#')) continue;
		const effective = trimmed.startsWith('export ') ? trimmed.slice(7).trim() : trimmed;
		const eqIndex = effective.indexOf('=');
		if (eqIndex === -1) continue;
		const key = effective.slice(0, eqIndex).trim();
		let value = effective.slice(eqIndex + 1).trim();
		// Inline comments are stripped only outside of quotes
		if (!value.startsWith('"') && !value.startsWith("'")) {
			const hashIndex = value.indexOf(' #');
			if (hashIndex !== -1) value = value.slice(0, hashIndex).trim();
		}
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
 * Prints which optional features are active and which wait for missing env
 * vars. `src/lib/dev/features.ts` is the source of truth, shared with the
 * in-context devNotice helper.
 *
 * Callers skip it in CI, on build, and during E2E.
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

export default defineConfig(async ({ command, mode }) => {
	const cwd = process.cwd();
	const loadedEnv = loadEnv(mode, cwd, '');
	// The build's commit SHA, or 'dev' without one. It names both the SvelteKit
	// version and the Sentry release.
	const buildVersion = appVersion();

	// Sentry is production-only. CF Workers Builds shares build env vars across the
	// production and preview triggers, so PUBLIC_SENTRY_DSN would otherwise bake into
	// preview and PR deploys: it loads the SDK on every public page (which destabilizes
	// the public E2E run) and reports PR errors into the prod Sentry project. Non-production
	// builds blank the Sentry vars. Blank, not delete: PUBLIC_SENTRY_DSN is a static public
	// variable in src/env.ts, and SvelteKit rejects a missing value at build time. An empty
	// string keeps the export but reads as falsy, so the SDK is still dead-code-eliminated.
	// Mirrors the prod/preview check in scripts/cf-deploy.ts (WORKERS_CI_BRANCH).
	const ciBranch = process.env.WORKERS_CI_BRANCH;
	const isProductionDeploy = !ciBranch || ciBranch === (process.env.PRODUCTION_BRANCH || 'main');
	if (!isProductionDeploy) {
		for (const key of ['PUBLIC_SENTRY_DSN', 'SENTRY_AUTH_TOKEN', 'SENTRY_ORG', 'SENTRY_PROJECT']) {
			process.env[key] = '';
			loadedEnv[key] = '';
		}
	}

	// Local Convex backend during `bun run dev` and `bun run dev:test` (not CI, builds,
	// postinstall, or scripts). dev:cloud runs via dev:frontend (lifecycle = "dev:frontend"),
	// so it is excluded.
	const lifecycle = process.env.npm_lifecycle_event;
	const useLocalConvex = localConvexMode(process.env) !== undefined;
	const isTestMode = lifecycle === 'dev:test';
	const stateIdSuffix = isTestMode ? 'e2e' : undefined;
	const plugins: PluginOption[] = [];

	if (useLocalConvex) {
		const backendPort = await findAvailablePort(Math.floor(Math.random() * 10_000) + 3210);
		const siteProxyPort = await findAvailablePort(backendPort + 1);
		const backendUrl = `http://localhost:${backendPort}`;
		const siteProxyUrl = `http://localhost:${siteProxyPort}`;
		const resetLocalBackend = process.env.RESET_LOCAL_BACKEND === 'true';

		// The state dir is wiped here, not via the plugin's reset option: the plugin removes
		// the whole dir at boot, after getPersistentBetterAuthSecret below has written the
		// fresh secret file into it. The reset run itself stays green (the backend keeps the
		// secret in memory), but every following run then re-rolls the secret against this
		// run's surviving JWKS rows, and /api/auth/convex/token 500s with "Failed to decrypt
		// private key" until the next reset.
		if (resetLocalBackend) {
			fs.rmSync(path.join(cwd, '.convex', computeLocalConvexStateId(cwd, stateIdSuffix)), {
				recursive: true,
				force: true
			});
		}

		// The backend URL file lets E2E tests (Playwright) discover it. Test mode writes a
		// separate file, so dev's .backend-url survives `bun run dev` and `bun run dev:test`
		// running concurrently.
		const convexStateDir = path.join(cwd, '.convex');
		fs.mkdirSync(convexStateDir, { recursive: true });
		const backendUrlFile = isTestMode ? '.test-backend-url' : '.backend-url';
		fs.writeFileSync(path.join(convexStateDir, backendUrlFile), backendUrl);
		if (isTestMode) {
			fs.writeFileSync(path.join(convexStateDir, '.test-site-url'), siteProxyUrl);
			clearTestBackendExit(cwd);
		}
		const betterAuthSecret =
			loadedEnv.BETTER_AUTH_SECRET?.trim() || getPersistentBetterAuthSecret(cwd, stateIdSuffix);

		// Convex backend env vars come from .env.convex.local. SITE_URL is stripped: locally
		// it must track the running dev server (or PORTLESS_SITE_URL), and a static value
		// copied into the file would pin Better Auth's trusted origin to the wrong origin and
		// silently break sign-in. The envVars callback below derives it and warns when a
		// stripped value differed.
		const {
			SITE_URL: ignoredLocalSiteUrl,
			CAPABILITY_PROFILE: _ignoredLocalCapabilityProfile,
			...convexLocalEnv
		} = parseEnvFile(path.join(cwd, '.env.convex.local'));
		const managedProviderUpdates = getManagedProviderUpdates(isTestMode ? {} : convexLocalEnv);
		// Merging the Convex backend env values into varlock's redaction map here cannot mask
		// convex-vite-plugin's startup logging: `resetRedactionMap` replaces the whole map, and
		// varlock's own vite integration calls it again from its `config` hook, which Vite runs
		// after this factory returns, so every merged value is dropped before the plugin logs.
		// The values are redacted at the sink (patches/convex-vite-plugin@0.4.0.patch).
		if (!isTestMode && !process.env.WORKERS_CI) {
			printOptionalFeatureBanner({
				convexEnv: convexLocalEnv,
				viteEnv: loadedEnv
			});
		}

		process.env.PUBLIC_CONVEX_URL = backendUrl;
		process.env.PUBLIC_CONVEX_SITE_URL = siteProxyUrl;

		// Heap knobs for the spawned local backend, which inherits this env. Better Auth's
		// bundle keeps ~50 MiB resident between requests. USER_HEAP (default 64 MiB) sizes the
		// working heap and prevents OOMs; EXTRA (default 32 MiB) is the carry-over allowance
		// the restart check uses. Without EXTRA the backend recycles the isolate after nearly
		// every UDF (TooMuchMemoryCarryOver) and each request re-imports the bundle.
		// https://github.com/get-convex/convex-backend/issues/312
		process.env.ISOLATE_MAX_USER_HEAP_SIZE ??= '134217728';
		process.env.ISOLATE_MAX_HEAP_EXTRA_SIZE ??= '134217728';

		plugins.push(
			{
				name: 'disable-local-convex-beacon',
				configureServer() {
					// Keep backend/test-only runtime switches out of Varlock's frontend manifest.
					process.env.DISABLE_BEACON = '1';
					if (isTestMode) process.env.LOCAL_E2E_RUNTIME = '1';
				}
			},
			{
				name: 'feature-catalog-without-restart',
				configResolved(config) {
					const kept = config.configFileDependencies.filter((file) => file !== featureCatalog);
					config.configFileDependencies.splice(0, Infinity, ...kept);
				}
			},
			convexLocal({
				convexDir: 'src/lib/convex',
				// One backend release for every checkout, so local runs and their measurements
				// compare like with like. The patched plugin starts a cached copy offline.
				binaryVersion: 'precompiled-2026-11-14-d63233b',
				port: backendPort,
				siteProxyPort,
				stateIdSuffix,
				// The plugin must never wipe the state dir itself: the reset already happened above,
				// before the better-auth secret file was written.
				reset: false,
				watch: { patterns: [] },
				onReady: [{ name: 'localDev:ensureSeededAdmin' }],
				onBackendExit: isTestMode ? (error) => recordTestBackendExit(error, cwd) : undefined,
				envVars: ({ vitePort, resolvedUrls }) => {
					// When portless fronts vite, resolvedUrls.local[0] is vite's own localhost URL, not
					// the .localhost named origin, so the trustedOrigin would mismatch. The predicate is
					// the one the dev and test wrappers use, so the wrapper-bound port, Playwright
					// baseURL, and Convex SITE_URL agree.
					const siteUrl = portlessOwnsPort()
						? process.env.PORTLESS_SITE_URL!
						: (resolvedUrls?.local[0] ?? `http://localhost:${vitePort}`);
					if (ignoredLocalSiteUrl && ignoredLocalSiteUrl !== siteUrl) {
						console.warn(
							`[convex] Ignoring SITE_URL (${logSafeOrigin(ignoredLocalSiteUrl)}) from .env.convex.local; ` +
								`using ${siteUrl} (derived from the running dev server) so local sign-in keeps working. ` +
								`Remove SITE_URL from .env.convex.local to silence this warning.`
						);
					}
					return {
						// Generated defaults for local dev
						BETTER_AUTH_SECRET: betterAuthSecret,
						SITE_URL: siteUrl,
						LOCAL_CONVEX_DEV: 'true',
						LOCAL_SEEDED_ADMIN_EMAIL: 'admin@local.dev',
						LOCAL_SEEDED_ADMIN_PASSWORD: 'LocalDevAdmin123!',
						LOCAL_SEEDED_ADMIN_NAME: 'Local Admin',
						// User values persist unless one of the five managed provider keys was removed.
						...convexLocalEnv,
						...managedProviderUpdates,
						// AUTH_E2E_TEST_SECRET authorizes test helpers only; it never enables providers.
						...(isTestMode && process.env.AUTH_E2E_TEST_SECRET
							? { AUTH_E2E_TEST_SECRET: process.env.AUTH_E2E_TEST_SECRET }
							: {}),
						// Launcher ownership is last so .env.convex.local cannot override the profile.
						CAPABILITY_PROFILE: isTestMode ? 'test' : 'local'
					};
				}
			})
		);
	}

	// PUBLIC_CONVEX_URL must be set for production builds so prerendering can initialize
	// the auth and Convex providers, which validate the URL at import time. The value does
	// not matter for prerendered pages: they render unauthenticated and never use the
	// Convex client. CI provides the real URL as a build secret.
	if (mode === 'production' && !process.env.PUBLIC_CONVEX_URL) {
		if (!process.env.CI && !process.env.WORKERS_CI) {
			console.warn(
				'[vite] PUBLIC_CONVEX_URL is not set. Using placeholder for prerendering. ' +
					'Set PUBLIC_CONVEX_URL in .env.local for production builds.'
			);
		}
		process.env.PUBLIC_CONVEX_URL = 'https://prerender-placeholder.convex.cloud';
	}

	// Sentry source map upload and auto-instrumentation
	if (loadedEnv.PUBLIC_SENTRY_DSN) {
		plugins.push(
			...(await sentrySvelteKit({
				autoUploadSourceMaps: !!(
					loadedEnv.SENTRY_AUTH_TOKEN &&
					loadedEnv.SENTRY_ORG &&
					loadedEnv.SENTRY_PROJECT
				),
				// Uploaded source maps carry the release the runtime init reports
				// (`version` from $app/env). Forwarded only while uploads are on.
				release: { name: buildVersion }
			}))
		);
	}

	// Kit writes the resolved env into <outDir>/generated/dev/env. Vitest and the dev:test stack
	// behind Playwright start their own Vite servers, and a shared outDir hands a running dev
	// server their env: the cloud Convex URLs in .env.local, or the E2E backend, which then
	// answers the dev server's sign-ins until that backend stops. The dev:test stack also gets
	// its own Vite cache: its config hashes differently, so on start its dependency optimizer
	// deletes and rewrites the dev server's prebundled node_modules/.vite/deps, and pages fail to
	// hydrate until the rewrite lands. Vitest needs no override: it scopes its own cache under
	// node_modules/.vite/vitest. Nested here, each stays inside every .svelte-kit ignore and
	// outside the dev server's watched generated/ directory.
	const isolatedOutDir =
		mode === 'test' ? '.svelte-kit/test' : isTestMode ? '.svelte-kit/e2e' : undefined;
	const kitOutDir = isolatedOutDir ?? '.svelte-kit';
	const isolatedCacheDir = isTestMode ? `${kitOutDir}/vite` : undefined;

	// On Cloudflare, varlock delivers env natively: the Workers loader reads the __VARLOCK_ENV
	// binding at worker boot, and `varlock-wrangler` (both deploy scripts wrap it) uploads that
	// binding at deploy time as worker vars + secrets. Nothing is embedded in the bundle, so no
	// @sensitive value can reach the worker script, which Cloudflare serves over its API and
	// archives per version. The adapter choice and this check read the same environment
	// (scripts/build-target.ts), so Workers Builds and Pages get the loader and an explicit
	// Node build never does. Only `vite build` emits the Worker: every other process that
	// loads this config runs in Node, where the loader throws for the missing binding.
	const cloudflareBuild = command === 'build' && isCloudflareBuild();
	// Third-party notices for the browser build. One instance per config factory
	// call, so the client plugin and its worker plugins share one accumulator.
	const licenses = thirdPartyLicenses();

	plugins.push(
		// The other adapters (Vercel, adapter-node) have no equivalent upload step, so there
		// the resolved manifest is serialized into the SSR bundle (ssrInjectMode below). It has
		// to drop the plaintext of @sensitive vars, which write-only platform secrets (Convex
		// deploy and preview keys, management token) would otherwise leave readable in the
		// deployed artifact, and it must not overwrite the host's runtime values with the empty
		// strings that stand in for them. buildStart runs after varlock's config reload and
		// before the manifest is serialized, and mutates the same live binding
		// varlockVitePlugin serializes. See scripts/strip-varlock-secrets.ts.
		{
			name: 'strip-varlock-sensitive-manifest-values',
			apply: 'build',
			buildStart() {
				if (mode === 'production' && !cloudflareBuild) {
					prepareEmbeddedEnvManifest(varlockLoadedEnv);
				}
			}
		},
		// Cloudflare: inject the Workers loader and embed no blob. Vercel/adapter-node
		// production: embed the resolved-env blob (their only delivery channel), prepared
		// above. Dev: init-only. An empty ssrEntryCode turns off varlock's own adapter
		// detection, which would inject the loader whenever adapter-cloudflare is configured.
		varlockVitePlugin(
			cloudflareBuild
				? { ssrEntryCode: [CLOUDFLARE_SSR_ENTRY_CODE], isCloudflareTarget: true }
				: mode === 'production'
					? { ssrInjectMode: 'resolved-env', ssrEntryCode: [] }
					: { ssrEntryCode: [] }
		),
		tailwindcss(),
		sveltekit({
			adapter: { cloudflare, node, auto }[buildAdapter()](),
			...(isolatedOutDir && {
				outDir: isolatedOutDir,
				// node_modules/$app/tsconfig.json stays shared. Its rootDirs keep naming the dev
				// server's route types, which editors and svelte-check resolve `./$types` through.
				typescript: {
					config: (config) => {
						const rootDirs: unknown = config.compilerOptions?.rootDirs;
						if (!Array.isArray(rootDirs)) return;
						config.compilerOptions.rootDirs = rootDirs.map((dir) =>
							String(dir).replace(`${isolatedOutDir}/types`, '.svelte-kit/types')
						);
					}
				}
			}),
			preprocess: vitePreprocess(),
			compilerOptions: {
				// Remote functions require the async compiler mode.
				experimental: { async: true }
			},
			inlineStyleThreshold: INLINE_STYLE_THRESHOLD,
			// object-src and base-uri stay enforced (a <meta> on prerendered pages, a header on SSR
			// pages). script-src runs report-only and reports to Sentry only when PUBLIC_SENTRY_DSN
			// is set at build time. frame-ancestors cannot ride a <meta> tag, so it lives in
			// hooks.server.ts, _headers and vercel.json. See src/lib/security/csp.js. script-src
			// hashes derive from the inline scripts of the app template. Evaluated after the
			// preview-build Sentry blanking above.
			csp: buildContentSecurityPolicy({
				sentryDsn: process.env.PUBLIC_SENTRY_DSN,
				appTemplate: fs.readFileSync(path.join(cwd, 'src/app.html'), 'utf8')
			}),
			experimental: {
				remoteFunctions: true
			},
			version: {
				name: buildVersion,
				// Polling /_app/version.json flips updated.current after a new deploy, so the
				// beforeNavigate guard in the root layout forces a full document load before importing
				// a dead chunk hash.
				pollInterval: 300000
			}
		}),
		licenses.plugin,
		marketingFonts(),
		// Startup rewrites of Kit's generated files must not reload the SSR runner mid-request.
		kitGeneratedHmr(kitOutDir),
		devtoolsJson(),
		// Serves the committed web fonts under hashed URLs. The static/fonts URLs remain for
		// emails, which need stable URLs across deployments.
		fontless({
			// Fontless requires a provider. With `remote: false`, the npm provider resolves
			// families only from installed font packages and makes no network request.
			provider: 'npm',
			npm: { remote: false },
			assets: { prefix: '/_app/immutable/fonts' },
			// Keep web-only fallback families out of the tokens shared with email rendering.
			processCSSVariables: false,
			// One face per authored weight, all pointing at the variable file.
			families: OUTFIT_WEIGHTS.map((weight) => ({
				name: 'Outfit',
				src: OUTFIT_FONT.href,
				weight,
				style: 'normal',
				display: 'swap' as const,
				unicodeRange: [...OUTFIT_UNICODE_RANGE],
				fallbacks: ['Arial'],
				// Every face shares one file, so the single preloaded face covers all weights.
				preload: true
			})),
			// Keep an installed Outfit version from replacing the self-hosted files.
			experimental: { disableLocalFallbacks: true }
		}),
		moduleGraph({
			outFile: path.join(cwd, kitOutDir, 'output', MODULE_GRAPH_FILE),
			root: cwd,
			publicEnv: () =>
				Object.fromEntries(
					Object.entries(envVariables).flatMap(([name, config]) =>
						'public' in config && config.public ? [[name, process.env[name]]] : []
					)
				)
		}),
		...(process.env.ANALYZE === 'true'
			? [
					visualizer({
						emitFile: true,
						filename: 'stats.html',
						template: 'treemap',
						gzipSize: true,
						brotliSize: true
					})
				]
			: [])
	);

	return {
		cacheDir: isolatedCacheDir,
		plugins,
		worker: {
			plugins: () => [licenses.workerPlugin()]
		},
		resolve: {
			alias: [{ find: /^tailwind-variants$/, replacement: 'tailwind-variants/lite' }]
		},
		// Local E2E renders the checked-in translations only; the root layout reads this
		// to keep live Tolgee off. A define rather than an env var: varlock re-injects
		// the parent's resolved env into this process, which empties a schema-declared
		// flag that dev-test.ts adds for its child.
		...(isTestMode && {
			define: { 'import.meta.env.VITE_LOCAL_E2E_RUNTIME': JSON.stringify('1') }
		}),
		test: {
			...sharedTestSettings,
			// Vitest reads the sequencer only from the root config, for every project.
			sequence: { sequencer: HeavySuiteSequencer },
			projects: [
				{
					extends: true as const,
					test: toolingTestSettings
				},
				{
					extends: true as const,
					test: {
						name: 'app',
						environment: 'jsdom',
						setupFiles: ['./src/test/jsdom-animation-frame.ts'],
						include: configDefaults.include.map((pattern) => `src/${pattern}`)
					}
				}
			]
		},
		optimizeDeps: {
			include: ['svelte-konva', 'konva', 'svelte-streamdown/code', 'svelte-streamdown/math']
		},
		ssr: {
			// The SSR prebundle copies Svelte's context into a second module.
			// setContext then runs outside the renderer's context and 500s the page.
			optimizeDeps: {
				exclude: ['svelte']
			},
			noExternal: [
				'svelte-konva',
				'@tolgee/web',
				// convex-svelte (>=0.14.0), @mmailaender/convex-better-auth-svelte (>=0.8.1), and
				// @stickerdaniel/convex-autumn-svelte (>=0.3.0) all ship a top-level `"svelte"` field,
				// so SvelteKit bundles them automatically. The WASM image codec of the
				// image-processing worker is bundled against SSR-time `import 'svelte'`-style hazards
				// should the package add main-thread surfaces; the worker chunk keeps the WASM payload
				// out of the client entry.
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
