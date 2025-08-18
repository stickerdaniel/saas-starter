import { defineConfig } from '@playwright/test';

/**
 * Read environment variables from file.
 * https://github.com/motdotla/dotenv
 */
import dotenv from 'dotenv';
dotenv.config({ path: '.env.test' });

export default defineConfig({
	webServer: {
		command: 'bun run build && bun run preview',
		port: 4173
	},
	testDir: 'e2e'
});
