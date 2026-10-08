import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer, type Plugin, type ViteDevServer } from 'vite';
import { afterEach, expect, it } from 'vitest';
import { kitGeneratedHmr } from './kit-generated-hmr';

const servers: ViteDevServer[] = [];
const roots: string[] = [];

afterEach(async () => {
	await Promise.all(servers.splice(0).map((server) => server.close()));
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/**
 * A dev server whose SSR runner has evaluated a generated module and a shared
 * module it imports, standing in for Svelte's runtime. `shared` returns the
 * runner's current instance of that module; a full reload replaces it.
 * `change` reports the generated file the way the watcher does and resolves
 * once Vite has handled the SSR side.
 */
async function serveGeneratedModule() {
	const root = mkdtempSync(path.join(tmpdir(), 'kit-generated-hmr-'));
	roots.push(root);
	const file = path.join(root, '.svelte-kit/generated/dev/server.js');
	mkdirSync(path.dirname(file), { recursive: true });
	writeFileSync(path.join(root, 'shared.js'), 'export const instance = {};\n');
	writeFileSync(file, "export { instance } from '/shared.js';\n");

	let handled: () => void = () => {};
	const ssrHandled: Plugin = {
		name: 'ssr-hot-update-handled',
		hotUpdate: {
			order: 'post',
			handler() {
				if (this.environment.name === 'ssr') handled();
			}
		}
	};
	const server = await createServer({
		configFile: false,
		root,
		logLevel: 'silent',
		appType: 'custom',
		optimizeDeps: { noDiscovery: true },
		server: { middlewareMode: true, watch: null },
		plugins: [kitGeneratedHmr(), ssrHandled]
	});
	servers.push(server);
	const runner = server.environments.ssr.runner;
	await runner.import('/.svelte-kit/generated/dev/server.js');
	const shared = async () => (await runner.import<{ instance: object }>('/shared.js')).instance;

	async function change(source: string) {
		writeFileSync(file, source);
		const done = new Promise<void>((resolve) => (handled = resolve));
		server.watcher.emit('change', server.config.root + '/.svelte-kit/generated/dev/server.js');
		await done;
		// The reload a handled report sends reaches the runner in this turn.
		await new Promise((resolve) => setImmediate(resolve));
	}

	return { shared, change, source: () => readFileSync(file, 'utf8') };
}

it('keeps evaluated SSR modules when a generated file is rewritten unchanged', async () => {
	const dev = await serveGeneratedModule();
	const before = await dev.shared();

	await dev.change(dev.source());

	expect(await dev.shared()).toBe(before);
});

it('still reloads the SSR runner when a generated file changed', async () => {
	const dev = await serveGeneratedModule();
	const before = await dev.shared();

	await dev.change(`${dev.source()}export const marker = 'changed';\n`);

	expect(await dev.shared()).not.toBe(before);
});
