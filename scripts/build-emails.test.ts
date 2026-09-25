// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { createViteServer } from './build-emails';

describe('email generator Vite server', () => {
	// Resolving the app's Vite config loads every plugin, which exceeds Vitest's
	// default timeout when the full suite competes for CPU.
	it('starts no file watcher', { timeout: 60_000 }, async () => {
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
});
