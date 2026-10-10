import * as childProcess from 'node:child_process';
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
import { buildContentSecurityPolicy } from './src/lib/security/csp.js';
import { appVersion } from './scripts/app-version';
import { buildAdapter, isCloudflareBuild } from './scripts/build-target';
import { findAvailablePort, portlessOwnsPort } from './scripts/dev-ports';
import { getManagedProviderUpdates, logSafeOrigin } from './scripts/local-convex-env';
import { prepareEmbeddedEnvManifest } from './scripts/strip-varlock-secrets';
import { thirdPartyLicenses } from './scripts/third-party-licenses/index';
import { OUTFIT_WEIGHTS, marketingFonts } from './scripts/marketing-fonts';
import { kitGeneratedHmr } from './scripts/kit-generated-hmr';
import { sentrySvelteKit } from '@sentry/sveltekit/vite';
import devtoolsJson from 'vite-plugin-devtools-json';
import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { configDefaults, defineConfig } from 'vitest/config';
import { visualizer } from 'rollup-plugin-visualizer';
import { fontless } from 'fontless';
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
	// Sentry vars for any non-production build. Blank, not delete: PUBLIC_SENTRY_DSN is a
	// static public variable in src/env.ts, and SvelteKit rejects a missing value at build
	// time. An empty string keeps the export but reads as falsy, so the SDK is still
	// dead-code-eliminated. Mirrors the prod/preview check in scripts/cf-deploy.ts
	// (WORKERS_CI_BRANCH).
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
		const {
			SITE_URL: ignoredLocalSiteUrl,
			CAPABILITY_PROFILE: _ignoredLocalCapabilityProfile,
			...convexLocalEnv
		} = parseEnvFile(path.join(cwd, '.env.convex.local'));
		const managedProviderUpdates = getManagedProviderUpdates(isTestMode ? {} : convexLocalEnv);
		// The Convex backend env values used to be merged into varlock's redaction
		// map here so that convex-vite-plugin's startup logging was masked. That
		// never worked: `resetRedactionMap` replaces the whole map rather than
		// adding to it, and varlock's own vite integration calls it again from its
		// `config` hook — which Vite runs after this factory returns — so every
		// merged value was dropped before the plugin ever logged. The values are
		// redacted at the sink instead (patches/convex-vite-plugin@0.4.0.patch).
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
			{
				name: 'disable-local-convex-beacon',
				configureServer() {
					// Keep backend/test-only runtime switches out of Varlock's frontend manifest.
					process.env.DISABLE_BEACON = '1';
					if (isTestMode) process.env.LOCAL_E2E_RUNTIME = '1';
				}
			},
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
							`[convex] Ignoring SITE_URL (${logSafeOrigin(ignoredLocalSiteUrl)}) from .env.convex.local; ` +
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

	// On Cloudflare, varlock delivers env natively: the Workers loader reads the __VARLOCK_ENV
	// binding at worker boot, and `varlock-wrangler` (both deploy scripts wrap it) uploads that
	// binding at deploy time as worker vars + secrets. Nothing is embedded in the bundle, so no
	// @sensitive value can reach the worker script, which Cloudflare serves over its API and
	// archives per version. The loader options are passed explicitly: varlock's adapter
	// auto-detection reads the SvelteKit 2 option shape and finds nothing under SvelteKit 3.
	// The adapter choice and this check read the same environment (scripts/build-target.ts),
	// so Workers Builds and Pages get the loader and an explicit Node build never does.
	const cloudflareBuild = isCloudflareBuild();
	// Third-party notices for the browser build. One instance per config factory
	// call, so the client plugin and its worker plugins share one accumulator.
	const licenses = thirdPartyLicenses();

	plugins.push(
		// The other adapters (Vercel, adapter-node) have no equivalent upload step, so there
		// the resolved manifest IS still serialized into the SSR bundle (ssrInjectMode below).
		// It has to drop the plaintext of @sensitive vars, which write-only platform secrets
		// (Convex deploy/preview keys, management token) would otherwise leave readable in the
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
		// above. Dev: init-only.
		varlockVitePlugin(
			cloudflareBuild
				? {
						ssrEntryCode: [CLOUDFLARE_SSR_ENTRY_CODE],
						ssrEdgeRuntime: true,
						isCloudflareTarget: true
					}
				: mode === 'production'
					? { ssrInjectMode: 'resolved-env' }
					: {}
		),
		tailwindcss(),
		sveltekit({
			adapter: { cloudflare, node, auto }[buildAdapter()](),
			// Consult https://svelte.dev/docs/kit/integrations
			// for more information about preprocessors
			preprocess: vitePreprocess(),
			compilerOptions: {
				// Remote functions require the async compiler mode.
				experimental: { async: true }
			},
			// Prioritize first paint over stylesheet caching on full document loads.
			inlineStyleThreshold: 256 * 1024,
			// object-src/base-uri stay enforced (embedded as <meta> on prerendered
			// pages, as a header on SSR pages). script-src runs report-only and is
			// wired to Sentry only when PUBLIC_SENTRY_DSN is set at build time.
			// frame-ancestors is not here — it cannot ride a <meta> tag, so it lives
			// in hooks.server.ts / _headers / vercel.json. See src/lib/security/csp.js.
			// script-src hashes are derived from the inline scripts of the app template.
			// Evaluated after the preview-build Sentry blanking above.
			csp: buildContentSecurityPolicy({
				sentryDsn: process.env.PUBLIC_SENTRY_DSN,
				appTemplate: fs.readFileSync(path.join(cwd, 'src/app.html'), 'utf8')
			}),
			experimental: {
				remoteFunctions: true
			},
			version: {
				name: appVersion(),
				// Poll /_app/version.json in the background so updated.current flips to
				// true after a new deploy, letting the beforeNavigate guard in the root
				// layout force a full document load before importing a dead chunk hash.
				pollInterval: 300000
			}
		}),
		licenses.plugin,
		marketingFonts(),
		// Startup rewrites of .svelte-kit/generated must not reload the SSR runner mid-request.
		kitGeneratedHmr(),
		devtoolsJson(),
		// Download and self-host the web fonts. Existing static/fonts URLs remain
		// available for emails, which need stable URLs across deployments.
		fontless({
			provider: 'google',
			throwOnError: true,
			assets: { prefix: '/_app/immutable/fonts' },
			// Keep web-only fallback families out of the tokens shared with email rendering.
			processCSSVariables: false,
			families: [
				{
					name: 'Outfit',
					weights: [...OUTFIT_WEIGHTS],
					styles: ['normal'],
					subsets: ['latin'],
					fallbacks: ['Arial'],
					display: 'swap',
					// `true` selects only one face; keep all configured weights preloaded.
					preload: { subsets: ['latin'], styles: ['normal'] }
				}
			],
			// Keep an installed Outfit version from replacing the self-hosted files.
			experimental: { disableLocalFallbacks: true }
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
					})
				]
			: [])
	);

	return {
		plugins,
		worker: {
			plugins: () => [licenses.workerPlugin()]
		},
		// Local E2E renders the checked-in translations only; the root layout reads this
		// to keep live Tolgee off. A define rather than an env var: varlock re-injects
		// the parent's resolved env into this process, which empties a schema-declared
		// flag that dev-test.ts adds for its child.
		...(isTestMode && {
			define: { 'import.meta.env.VITE_LOCAL_E2E_RUNTIME': JSON.stringify('1') }
		}),
		test: {
			exclude: [
				'e2e/**',
				'**/node_modules/**',
				'dist/**',
				'.{idea,git,cache,output,temp}/**',
				'docs/**',
				'scratch/**',
				'.opencode/**',
				'references/**',
				// Agent worktrees and symlinked skills are copies of owned tests.
				// Discover the originals, including .agents/skills/, only once.
				'.claude/**',
				// The creator package has its own Vitest project and root command.
				'packages/create-saas-starter/test/**',
				// Repository-spawning detector tests run in their own CI job.
				'.agents/skills/upstream-report/scripts/upstream-relevance.integration.test.ts'
			],
			passWithNoTests: true,
			// Svelte's async tick() resolves on the next animation frame. Faking that
			// frame leaves the callback queued forever in jsdom, so timer tests keep
			// the real frame (installed for this runner in the app setup) and only
			// fake the timers they advance.
			fakeTimers: {
				toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] as [
					'setTimeout',
					'clearTimeout',
					'setInterval',
					'clearInterval',
					'Date'
				]
			},
			projects: [
				{
					extends: true as const,
					test: {
						name: 'tooling',
						environment: 'node',
						exclude: ['src/**']
					}
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
			include: ['svelte-konva', 'konva']
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
