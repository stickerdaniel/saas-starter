import { defineConfig, mergeConfig } from 'vitest/config';
import { sharedTestSettings, toolingTestSettings } from './scripts/vitest-settings.ts';

export default defineConfig({
	// Tooling tests must not depend on SvelteKit's generated tsconfig or application env.
	tsconfig: './tsconfig.tooling.json',
	test: mergeConfig(sharedTestSettings, toolingTestSettings)
});
