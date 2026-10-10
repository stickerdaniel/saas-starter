import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, expect, type Browser, type Page } from '@playwright/test';
import { createServer, type ViteDevServer } from 'vite';
import { svelte, vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import tailwindcss from '@tailwindcss/vite';

const root = fileURLToPath(new URL('../', import.meta.url));
const tolerance = 2;
const operationTimeout = 10_000;

// Inspect the effective scroll owner, not a particular wrapper or utility class.
function geometry() {
	const table = document.querySelector('table');
	const header = table?.tHead;
	const firstRow = table?.tBodies[0]?.rows[0];
	const lastRow = table?.tBodies[0]?.rows[table.tBodies[0].rows.length - 1];
	if (!table || !header || !firstRow || !lastRow) throw new Error('Table is not ready');
	let viewport = table.parentElement;
	while (viewport?.parentElement) {
		if (
			/(auto|scroll)/.test(getComputedStyle(viewport).overflowY) &&
			viewport.scrollHeight > viewport.clientHeight + 2
		)
			break;
		viewport = viewport.parentElement;
	}
	if (!viewport) throw new Error('Table has no scroll viewport');
	const rect = (element: Element) => {
		const { top, bottom, left, right, width, height } = element.getBoundingClientRect();
		return { top, bottom, left, right, width, height };
	};
	return {
		header: rect(header),
		viewport: rect(viewport),
		firstRow: rect(firstRow),
		lastRow: rect(lastRow),
		scrollTop: viewport.scrollTop,
		columns: Array.from(header.querySelectorAll('th'), (head, index) => ({
			header: rect(head),
			cell: rect(firstRow.cells[index]!)
		}))
	};
}

async function check(page: Page) {
	await page.getByRole('button', { name: 'Review 24', exact: true }).waitFor();
	await page.evaluate(() => document.fonts.ready.then(() => undefined));
	const initial = await page.evaluate(geometry);
	await page.mouse.move(initial.viewport.left + 100, initial.viewport.top + 100);
	await page.mouse.wheel(0, 240);
	await expect
		.poll(async () => initial.firstRow.top - (await page.evaluate(geometry)).firstRow.top, {
			message: 'Scrolling the table must bring different rows into view',
			timeout: operationTimeout
		})
		.toBeGreaterThan(150);
	const scrolled = await page.evaluate(geometry);
	console.log('Vertical scroll:', JSON.stringify({ initial, scrolled }));
	assert(
		scrolled.header.top >= scrolled.viewport.top - tolerance &&
			scrolled.header.bottom <= scrolled.viewport.bottom + tolerance,
		'The header must stay visible while rows scroll; bound the actual table scroll owner, not its outer shell'
	);
	assert(
		Math.abs(scrolled.header.top - initial.header.top) <= tolerance,
		'The header must stay in place while different rows move into view'
	);

	await page.getByRole('table').evaluate((table) => {
		let viewport = table.parentElement;
		while (viewport) {
			if (
				/(auto|scroll)/.test(getComputedStyle(viewport).overflowX) &&
				viewport.scrollWidth > viewport.clientWidth
			) {
				viewport.scrollLeft = viewport.scrollWidth;
				break;
			}
			viewport = viewport.parentElement;
		}
	});
	const horizontal = await page.evaluate(geometry);
	const finalColumn = horizontal.columns.at(-1)!;
	assert(
		finalColumn.header.right <= horizontal.viewport.right + tolerance &&
			finalColumn.header.left >= horizontal.viewport.left - tolerance,
		'Horizontal scrolling must expose the final column'
	);
	for (const column of horizontal.columns) {
		assert(
			Math.abs(column.header.left - column.cell.left) <= tolerance &&
				Math.abs(column.header.width - column.cell.width) <= tolerance,
			'Header and body columns must remain aligned during horizontal scrolling'
		);
	}

	const panel = await page.getByRole('region', { name: 'Table scroll contract' }).boundingBox();
	const next = page.getByRole('button', { name: 'Go to next page' });
	const pagination = await next.boundingBox();
	assert(
		panel &&
			pagination &&
			pagination.y >= horizontal.viewport.bottom - tolerance &&
			pagination.y + pagination.height <= panel.y + panel.height + tolerance,
		'Pagination must remain outside the row scroller and inside the short panel; keep the entire flex chain shrinkable'
	);
	await next.click();
	await expect(next).toBeDisabled();

	await page.getByRole('button', { name: 'Review 24', exact: true }).focus();
	for (let index = 0; index < 23; index++) {
		await page.keyboard.press('Shift+Tab');
		const focus = await page.evaluate(() => {
			const active = document.activeElement;
			const header = document.querySelector('thead');
			if (!active?.closest('tbody') || !header)
				throw new Error('Reverse-tab must enter a row control');
			return {
				name: active.textContent,
				top: active.getBoundingClientRect().top,
				headerBottom: header.getBoundingClientRect().bottom
			};
		});
		assert(
			focus.top >= focus.headerBottom + tolerance,
			`Reverse-tab must reveal ${focus.name} below the rendered header with focus-ring clearance: ${JSON.stringify(focus)}`
		);
	}
	console.log(
		'PASS: moving rows, sticky header, aligned horizontal access, reachable pagination and unobscured reverse-tab focus'
	);
}

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

const started = performance.now();
const temporary = await mkdtemp(join(tmpdir(), 'table-scroll-'));
let server: ViteDevServer | undefined;
let browser: Browser | undefined;
let stopping = false;
let workFinished = false;
// Last resort for a stuck third-party shutdown, after both closes have been attempted.
const hardDeadline = setTimeout(() => {
	console.error('Table scroll check exceeded its overall shutdown deadline');
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
						name: 'table-scroll-fixture',
						configResolved(config) {
							for (const environment of Object.values(config.environments)) {
								environment.optimizeDeps.noDiscovery = true;
								environment.optimizeDeps.include = [];
							}
							config.optimizeDeps.include = [];
						},
						resolveId(id) {
							if (id === '$app/env') return '\0table-scroll-env';
						},
						load(id) {
							if (id === '\0table-scroll-env') return 'export const browser = true;';
						},
						configureServer(vite) {
							vite.middlewares.use((request, response, next) => {
								if (request.url !== '/') return next();
								response.setHeader('Content-Type', 'text/html');
								response.end(
									`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Table scroll check</title></head><body><div id="app"></div><script type="module">import {mount} from '/node_modules/svelte/src/index-client.js';import App from '/src/lib/components/tables/test-fixtures/TableScrollHarness.svelte';import '/src/routes/layout.css';mount(App,{target:document.getElementById('app')});</script></body></html>`
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
			await page.goto(`http://127.0.0.1:${address.port}`);
			await check(page);
			assert.deepEqual(errors, [], 'The real table fixture must not raise browser errors');
		})().finally(() => {
			workFinished = true;
		}),
		90_000,
		'Table scroll check'
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
	console.log(`Table scroll check: ${((performance.now() - started) / 1000).toFixed(2)}s`);
	for (const result of cleanup)
		if (result.status === 'rejected') {
			console.error(result.reason);
			process.exitCode = 1;
		}
}
