import auto from '@sveltejs/adapter-auto';
import cloudflare from '@sveltejs/adapter-cloudflare';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

// Workers Builds sets WORKERS_CI but adapter-auto only checks CF_PAGES.
// Use adapter-cloudflare explicitly when WORKERS_CI is detected.
const adapter = process.env.WORKERS_CI ? cloudflare() : auto();

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
		}
	}
};

export default config;
