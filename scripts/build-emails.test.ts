// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { createViteServer } from './build-emails';

describe('email generator Vite server', () => {
	// The app config runs SvelteKit, varlock and the local Convex backend, and each of
	// them writes state that a dev server in the same checkout reads.
	it('loads none of the app Vite config', async () => {
		const vite = await createViteServer();
		try {
			expect(vite.config.configFile).toBeUndefined();
		} finally {
			await vite.close();
		}
	});

	it('starts no file watcher', async () => {
		const vite = await createViteServer();
		try {
			// createServer builds Vite's no-op watcher only when the resolved
			// server.watch is null, and otherwise its bundled chokidar FSWatcher, which
			// sets `closed` in its constructor and keeps it after close(). Contents and
			// readiness say nothing once a real watcher has already been closed.
			expect(vite.config.server.watch).toBeNull();
			expect(vite.watcher).not.toHaveProperty('closed');
		} finally {
			await vite.close();
		}
	});

	// An optimizer would delete and rebuild the deps a running dev server serves from
	// the shared node_modules/.vite.
	it('runs no dependency optimizer', async () => {
		const vite = await createViteServer();
		try {
			for (const environment of Object.values(vite.environments)) {
				expect(environment.depsOptimizer, environment.name).toBeUndefined();
			}
		} finally {
			await vite.close();
		}
	});
});
