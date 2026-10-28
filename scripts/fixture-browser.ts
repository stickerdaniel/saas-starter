import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type Page } from '@playwright/test';
import { createServer, type ViteDevServer } from 'vite';
import { svelte, vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import tailwindcss from '@tailwindcss/vite';

const root = fileURLToPath(new URL('../', import.meta.url));
export const operationTimeout = 10_000;

async function deadline<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			promise,
			new Promise<never>((_, reject) => {
				timer = setTimeout(() => reject(new Error(`${label} exceeded ${ms}ms`)), ms);
			})
		]);
	} finally {
		clearTimeout(timer);
	}
}

/**
 * Mounts one Svelte fixture with the application stylesheet from an owned Vite server and
 * hands its page in headless Chromium to `run`, for layout checks that need a real CSS
 * engine but no backend. Query parameters on `origin` reach the fixture as string props.
 */
export async function runFixtureCheck({
	label,
	fixture,
	run
}: {
	/** Names the check in deadline errors and the timing line. */
	label: string;
	/** Fixture component path relative to the repository root. */
	fixture: string;
	run: (page: Page, origin: string) => Promise<void>;
}) {
	const started = performance.now();
	const temporary = await mkdtemp(join(tmpdir(), 'fixture-browser-'));
	let server: ViteDevServer | undefined;
	let browser: Browser | undefined;
	let stopping = false;
	let workFinished = false;
	// Last resort for a stuck third-party shutdown, after both closes have been attempted.
	const hardDeadline = setTimeout(() => {
		console.error(`${label} exceeded its overall shutdown deadline`);
		process.exit(1);
	}, 120_000);
	try {
		await deadline(
			(async () => {
				const tsconfig = join(temporary, 'tsconfig.json');
				await writeFile(
					tsconfig,
					JSON.stringify({
						compilerOptions: {
							target: 'ESNext',
							module: 'ESNext',
							moduleResolution: 'Bundler',
							verbatimModuleSyntax: true
						}
					})
				);
				server = await createServer({
					configFile: false,
					root,
					publicDir: false,
					tsconfig,
					cacheDir: join(temporary, 'vite'),
					optimizeDeps: { noDiscovery: true, entries: [] },
					plugins: [
						svelte({
							configFile: false,
							prebundleSvelteLibraries: false,
							preprocess: vitePreprocess()
						}),
						tailwindcss(),
						{
							name: 'fixture-browser',
							configResolved(config) {
								for (const environment of Object.values(config.environments)) {
									environment.optimizeDeps.noDiscovery = true;
									environment.optimizeDeps.include = [];
								}
								config.optimizeDeps.include = [];
							},
							resolveId(id) {
								if (id === '$app/env') return '\0fixture-browser-env';
							},
							load(id) {
								if (id === '\0fixture-browser-env') return 'export const browser = true;';
							},
							configureServer(vite) {
								vite.middlewares.use((request, response, next) => {
									if (new URL(request.url ?? '/', 'http://fixture').pathname !== '/') return next();
									response.setHeader('Content-Type', 'text/html');
									response.end(
										`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${label}</title></head><body><div id="app"></div><script type="module">import {mount} from '/node_modules/svelte/src/index-client.js';import App from '/${fixture}';import '/src/routes/layout.css';mount(App,{target:document.getElementById('app'),props:Object.fromEntries(new URLSearchParams(location.search))});</script></body></html>`
									);
								});
							}
						}
					],
					resolve: { alias: { '#lib': resolve(root, 'src/lib') } },
					server: { host: '127.0.0.1', port: 0, strictPort: true }
				});
				if (stopping) {
					await server.close();
					return;
				}
				await deadline(server.listen(), operationTimeout, 'Vite startup');
				if (stopping) return;
				const address = server.httpServer?.address();
				assert(
					address && typeof address !== 'string',
					'The owned Vite server must bind a free loopback port'
				);
				browser = await chromium.launch({ headless: true, timeout: operationTimeout });
				if (stopping) {
					await browser.close();
					return;
				}
				const page = await browser.newPage({
					viewport: { width: 1280, height: 800 },
					reducedMotion: 'reduce'
				});
				page.setDefaultTimeout(operationTimeout);
				page.setDefaultNavigationTimeout(30_000);
				const errors: string[] = [];
				page.on('pageerror', (error) => errors.push(error.message));
				await run(page, `http://127.0.0.1:${address.port}`);
				assert.deepEqual(errors, [], 'The real fixture must not raise browser errors');
			})().finally(() => {
				workFinished = true;
			}),
			90_000,
			label
		);
	} finally {
		stopping = true;
		const cleanup = await Promise.allSettled([
			deadline(
				Promise.resolve().then(() => browser?.close()),
				operationTimeout,
				'Browser shutdown'
			),
			deadline(
				Promise.resolve().then(() => server?.close()),
				operationTimeout,
				'Vite shutdown'
			)
		]);
		await rm(temporary, { recursive: true, force: true });
		if (workFinished && cleanup.every((result) => result.status === 'fulfilled')) {
			clearTimeout(hardDeadline);
		}
		console.log(`${label}: ${((performance.now() - started) / 1000).toFixed(2)}s`);
		for (const result of cleanup)
			if (result.status === 'rejected') {
				console.error(result.reason);
				process.exitCode = 1;
			}
	}
}
