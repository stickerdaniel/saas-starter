import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	// @ts-expect-error - Vitest includes its own version of Vite which causes type conflicts
	plugins: [tailwindcss(), sveltekit()],
	test: {
		exclude: ['e2e/**', 'node_modules/**', 'dist/**', '.{idea,git,cache,output,temp}/**']
	}
});
