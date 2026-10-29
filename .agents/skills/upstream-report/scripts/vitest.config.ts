import { defineConfig } from 'vitest/config';

export default defineConfig({
	// The root tsconfig extends SvelteKit's generated one, whose sync loads the application's
	// Vite config. The tooling tsconfig keeps this suite independent of both.
	tsconfig: './tsconfig.tooling.json',
	test: {
		include: [
			'.agents/skills/upstream-report/scripts/upstream-relevance.test.ts',
			'.agents/skills/upstream-report/scripts/upstream-relevance.integration.test.ts'
		],
		environment: 'node',
		passWithNoTests: false
	}
});
