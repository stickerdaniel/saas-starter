// @vitest-environment node

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
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

	// A dev server in the same checkout serves the env Kit writes under
	// .svelte-kit/generated and the dependencies it prebundled into
	// node_modules/.vite/deps, and editors resolve its route types through the shared
	// node_modules/$app/tsconfig.json. The generator renders with its own env and
	// config, which must reach none of them. It runs in a fresh process because
	// varlock settles the env once per process, so a second server here would ignore
	// the override, and without __VARLOCK_ENV, which would hand the child this
	// process's env instead.
	it('leaves a running dev server its env, deps and route types', { timeout: 60_000 }, () => {
		const sentinel = 'https://email-generator.invalid';
		// Any file in the dev server's deps cache disappears if the generator's
		// optimizer rewrites that cache for its own config hash.
		const devDep = 'node_modules/.vite/deps/email-generator-sentinel.js';
		mkdirSync(dirname(devDep), { recursive: true });
		writeFileSync(devDep, '');
		const { __VARLOCK_ENV: _parentEnv, ...env } = process.env;
		const output = execFileSync(
			'bun',
			[
				'-e',
				`import { createViteServer } from './scripts/build-emails.ts';
				const vite = await createViteServer();
				const env = await vite.ssrLoadModule('$app/env/public');
				await vite.close();
				console.log(env.PUBLIC_CONVEX_URL);`
			],
			{ env: { ...env, PUBLIC_CONVEX_URL: sentinel }, encoding: 'utf8', timeout: 50_000 }
		);
		expect(output.trim().split('\n').at(-1)).toBe(sentinel);
		expect(existsSync(devDep), 'the email renderer needs its own Vite cacheDir').toBe(true);
		rmSync(devDep);
		const devEnv = '.svelte-kit/generated/dev/env/public/server.js';
		expect(existsSync(devEnv) ? readFileSync(devEnv, 'utf8') : '').not.toContain(sentinel);
		const tsconfig = JSON.parse(readFileSync('node_modules/$app/tsconfig.json', 'utf8'));
		expect(tsconfig.compilerOptions.rootDirs).toEqual(['../..', '../../.svelte-kit/types']);
	});
});
