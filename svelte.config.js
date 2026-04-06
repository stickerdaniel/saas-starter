import auto from '@sveltejs/adapter-auto';
import cloudflare from '@sveltejs/adapter-cloudflare';
import node from '@sveltejs/adapter-node';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

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
const LANGUAGES = ['en', 'de', 'es', 'fr'];
const prerenderEntries = LANGUAGES.flatMap((lang) =>
	PRERENDER_MARKETING_PAGES.map((page) => `/${lang}${page}`)
);

/** @type {import('@sveltejs/kit').Config} */
const config = {
	// Consult https://svelte.dev/docs/kit/integrations
	// for more information about preprocessors
	preprocess: vitePreprocess(),

	kit: {
		adapter,
		alias: {
			$blocks: 'src/blocks'
		},
		experimental: {
			remoteFunctions: true
		},
		prerender: {
			entries: prerenderEntries,
			handleMissingId: 'warn'
		}
	}
};

export default config;
