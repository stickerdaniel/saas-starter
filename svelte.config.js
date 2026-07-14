import { execSync } from 'node:child_process';
import auto from '@sveltejs/adapter-auto';
import cloudflare from '@sveltejs/adapter-cloudflare';
import node from '@sveltejs/adapter-node';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import { buildContentSecurityPolicy } from './src/lib/security/csp.js';
import { SUPPORTED_LANGUAGES } from './src/lib/i18n/languages.ts';

// Workers Builds sets WORKERS_CI but adapter-auto only checks CF_PAGES.
// Use adapter-cloudflare explicitly when WORKERS_CI is detected.
// NODE_ADAPTER=1 opts into adapter-node for self-hosted (Coolify/Nixpacks) builds.
const adapter = process.env.WORKERS_CI
	? cloudflare()
	: process.env.NODE_ADAPTER === '1'
		? node()
		: auto();

// Prerenderable marketing pages (pricing excluded — uses useCustomer() for billing UI)
const PRERENDER_MARKETING_PAGES = ['', '/about', '/privacy', '/terms', '/impressum'];
const LANGUAGES = SUPPORTED_LANGUAGES.map((language) => language.code);
const prerenderEntries = LANGUAGES.flatMap((lang) =>
	PRERENDER_MARKETING_PAGES.map((page) => `/${lang}${page}`)
);

// A deterministic, per-commit app version so the client can detect a new
// deploy and recover from dead chunk hashes. The default build timestamp is
// non-deterministic across the two CI build steps within one deploy, which
// breaks the failed-import safety net. Prefer the commit SHA injected by the
// build host (Workers Builds, then Vercel), fall back to a local git rev, and
// finally to 'dev' so non-git build hosts still get a stable name.
function appVersion() {
	const sha = process.env.WORKERS_CI_COMMIT_SHA || process.env.VERCEL_GIT_COMMIT_SHA;
	if (sha) return sha;
	try {
		return execSync('git rev-parse HEAD').toString().trim();
	} catch {
		return 'dev';
	}
}

/** @type {import('@sveltejs/kit').Config} */
const config = {
	// Consult https://svelte.dev/docs/kit/integrations
	// for more information about preprocessors
	preprocess: vitePreprocess(),

	kit: {
		adapter,
		alias: {
			$blocks: 'src/blocks',
			$static: 'static'
		},
		// object-src/base-uri stay enforced (embedded as <meta> on prerendered
		// pages, as a header on SSR pages). script-src runs report-only and is
		// wired to Sentry only when PUBLIC_SENTRY_DSN is set at build time.
		// frame-ancestors is not here — it cannot ride a <meta> tag, so it lives
		// in hooks.server.ts / _headers / vercel.json. See src/lib/security/csp.js.
		csp: buildContentSecurityPolicy({ sentryDsn: process.env.PUBLIC_SENTRY_DSN }),
		experimental: {
			remoteFunctions: true
		},
		prerender: {
			entries: prerenderEntries,
			handleMissingId: 'warn'
		},
		version: {
			name: appVersion(),
			// Poll /_app/version.json in the background so updated.current flips to
			// true after a new deploy, letting the beforeNavigate guard in the root
			// layout force a full document load before importing a dead chunk hash.
			pollInterval: 300000
		}
	}
};

export default config;
