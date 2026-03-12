import adapter from '@sveltejs/adapter-auto';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	// Consult https://svelte.dev/docs/kit/integrations
	// for more information about preprocessors
	preprocess: vitePreprocess(),

	kit: {
		adapter: adapter(),
		alias: {
			$blocks: 'src/blocks',
			'@mmailaender/convex-better-auth-svelte/svelte': 'src/lib/auth-svelte.svelte.ts'
		},
		experimental: {
			remoteFunctions: true
		}
	}
};

export default config;
