// @vitest-environment node

import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
	existsSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	realpathSync,
	rmSync,
	symlinkSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { normalizePath } from 'vite';
import { expect, it } from 'vitest';

// Kit and Vite write their output under the working directory, so a checkout's
// own .svelte-kit and .convex stay out of the fixture: a local Playwright stack
// running there keeps its generated env, and this run cannot reach it.
const PER_CHECKOUT_OUTPUT = new Set([
	'.convex',
	'.git',
	'.svelte-kit',
	'playwright-report',
	'test-results'
]);

/**
 * A directory that links every source entry of this checkout and holds no output.
 * Its real path, because the child's cwd and Vite's resolved paths are real paths
 * and macOS reaches the temp directory through the /var symlink.
 */
function linkedCheckout(): string {
	const dir = realpathSync(mkdtempSync(join(tmpdir(), 'dev-test-isolation-')));
	for (const entry of readdirSync('.')) {
		if (!PER_CHECKOUT_OUTPUT.has(entry)) symlinkSync(resolve(entry), join(dir, entry));
	}
	return dir;
}

// A `bun run dev` server in the same checkout serves the env Kit writes under
// .svelte-kit/generated and the deps prebundled into node_modules/.vite. The
// dev:test stack behind Playwright starts the app config under its own lifecycle,
// and must reach neither. The stack runs in a fresh process because varlock
// settles the env once per process, and without __VARLOCK_ENV, which would hand
// the child this process's env instead. CI skips the local Convex backend the
// dev:test config would otherwise boot.
it('leaves a running dev server its env and dependency cache', { timeout: 60_000 }, () => {
	const checkout = linkedCheckout();
	try {
		const sentinel = `https://dev-test-${randomUUID()}.invalid`;
		const { __VARLOCK_ENV: _parentEnv, ...env } = process.env;
		const output = execFileSync(
			'bun',
			[
				'-e',
				`import { createServer } from 'vite';
				const vite = await createServer({
					server: { middlewareMode: true, ws: false, watch: null },
					appType: 'custom',
					logLevel: 'warn'
				});
				const env = await vite.ssrLoadModule('$app/env/public');
				await vite.close();
				console.log(JSON.stringify({ url: env.PUBLIC_CONVEX_URL, cacheDir: vite.config.cacheDir }));`
			],
			{
				cwd: checkout,
				env: { ...env, CI: '1', npm_lifecycle_event: 'dev:test', PUBLIC_CONVEX_URL: sentinel },
				encoding: 'utf8',
				timeout: 50_000
			}
		);
		const served: { url: string; cacheDir: string } = JSON.parse(output.trim().split('\n').at(-1)!);

		expect(served.url).toBe(sentinel);
		const devEnv = join(checkout, '.svelte-kit/generated/dev/env/public/server.js');
		expect(existsSync(devEnv) ? readFileSync(devEnv, 'utf8') : '').not.toContain(sentinel);
		// Vite resolves cacheDir with forward slashes, also on Windows.
		expect(served.cacheDir).not.toBe(normalizePath(join(checkout, 'node_modules/.vite')));
	} finally {
		rmSync(checkout, { recursive: true, force: true });
	}
});
