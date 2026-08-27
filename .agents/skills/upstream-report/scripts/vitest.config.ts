import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		include: ['.agents/skills/upstream-report/scripts/upstream-relevance.integration.test.ts'],
		environment: 'node',
		passWithNoTests: false
	}
});
