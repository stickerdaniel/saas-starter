import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		include: ['test/**/*.test.ts'],
		// On Windows every Bun child starts through a PowerShell Job Object runner. Hosted runners
		// have taken over 20 s for one cold runner start, and some tests start two.
		testTimeout: process.platform === 'win32' ? 60_000 : 20_000
	}
});
