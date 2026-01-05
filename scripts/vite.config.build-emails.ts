import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { resolve } from 'path';

export default defineConfig({
	plugins: [
		svelte({
			compilerOptions: {
				generate: 'server'
			}
		})
	],
	resolve: {
		alias: {
			$lib: resolve('./src/lib')
		}
	},
	ssr: {
		// Don't externalize these - bundle them
		noExternal: ['better-svelte-email', 'svelte']
	},
	build: {
		ssr: true
	}
});
