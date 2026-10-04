import { spawn } from 'node:child_process';
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as v from 'valibot';
import { afterEach, describe, expect, it } from 'vitest';
import { catalogueSchema } from '../../src/lib/licenses/catalogue';

// Builds a small SvelteKit app with the installed Vite, Kit, and Svelte and the
// real notice plugins, then reads what Kit's builder.writeClient published and
// renders a request through the server builder.writeServer copied. Packages are
// synthetic markers, so inclusion and exclusion are observable.

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PLUGIN_ENTRY = path
	.join(REPO_ROOT, 'scripts/third-party-licenses/index.ts')
	.replaceAll('\\', '/');
const VITE_BIN = path.join(REPO_ROOT, 'node_modules/vite/bin/vite.js');
const LINKED_PACKAGES = ['vite', 'svelte', '@sveltejs/kit', 'valibot', 'spdx-license-list'];
const BUILD_DEADLINE_MS = 90_000;
const RENDER_DEADLINE_MS = 20_000;
const TEST_TIMEOUT_MS = 120_000;

interface MarkerPackage {
	name: string;
	files?: Record<string, string>;
	manifest?: Record<string, unknown>;
}

const licensed = (name: string): MarkerPackage => ({
	name,
	files: { LICENSE: `Synthetic license for ${name}` }
});

const BASE_PACKAGES: MarkerPackage[] = [
	{
		name: 'client-marker',
		files: { LICENSE: 'Client marker license', NOTICE: 'Client marker attribution' }
	},
	// Server-only and without any notice text: it must neither fail nor publish.
	{ name: 'server-only-marker' },
	licensed('live-marker'),
	licensed('nested-marker'),
	licensed('inline-marker'),
	licensed('unused-inline-marker'),
	licensed('dead-marker'),
	licensed('dead-inline-marker'),
	licensed('cli-only-marker'),
	{
		name: 'css-marker',
		manifest: { style: 'index.css' },
		files: { LICENSE: 'CSS marker license', 'index.css': '.css-marker { color: red; }' }
	},
	{ name: 'bare-marker' },
	{
		name: 'primaryless-marker',
		files: {
			NOTICE: 'Supplemental attribution only',
			'codec/LICENSE.codec.md': 'Nested codec license',
			'codec/index.js': 'export const codec = "primaryless-marker";'
		}
	}
];

const PAGE = (extraImports: string) => `<script>
	import { onMount } from 'svelte';
	import { marker } from 'client-marker';
	import Live from '../live.worker.js?worker';
	import Dead from '../dead.worker.js?worker';
	import Inline from '../inline.worker.js?worker&inline';
	import DeadInline from '../dead-inline.worker.js?sharedworker&inline';
	import UnusedInline from '../unused-inline.worker.js?worker&inline';
	import '../style.css';
	${extraImports}
	let { data } = $props();
	onMount(() => {
		const workers = [new Live(), new Inline()];
		return () => workers.forEach((worker) => worker.terminate());
	});
</script>

<h1>{marker} {data.marker}</h1>
{#each data.entries ?? [] as entry (entry.id)}
	<details>
		<summary>{entry.name}</summary>
		{#each entry.notices as notice, index (index)}
			<pre>{notice.text}</pre>
		{/each}
	</details>
{:else}
	<p>No catalogue</p>
{/each}
`;

const roots: string[] = [];

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function writeTree(root: string, files: Record<string, string>) {
	for (const [relative, content] of Object.entries(files)) {
		const file = path.join(root, relative);
		mkdirSync(path.dirname(file), { recursive: true });
		writeFileSync(file, content);
	}
}

function createFixture(
	options: {
		extraImports?: string;
		extraPlugins?: string;
		kitFiles?: string;
		files?: Record<string, string>;
	} = {}
) {
	const root = mkdtempSync(path.join(tmpdir(), 'third-party-kit-'));
	roots.push(root);
	for (const name of LINKED_PACKAGES) {
		const target = path.join(root, 'node_modules', ...name.split('/'));
		mkdirSync(path.dirname(target), { recursive: true });
		symlinkSync(path.join(REPO_ROOT, 'node_modules', ...name.split('/')), target, 'junction');
	}
	for (const pkg of BASE_PACKAGES) {
		writeTree(path.join(root, 'node_modules', pkg.name), {
			'package.json': JSON.stringify({
				name: pkg.name,
				version: '1.0.0',
				type: 'module',
				main: 'index.js',
				license: 'MIT',
				...pkg.manifest
			}),
			'index.js': `export const marker = ${JSON.stringify(pkg.name)};`,
			...pkg.files
		});
	}
	writeTree(root, {
		'package.json': JSON.stringify({
			name: 'third-party-kit-fixture',
			private: true,
			type: 'module',
			dependencies: { 'cli-only-marker': '1.0.0' }
		}),
		'third-party-licenses.config.json': JSON.stringify({
			extraPackages: [{ name: 'css-marker', components: ['styles'] }]
		}),
		'svelte.config.js': `export default {
	kit: {
		${options.kitFiles ?? ''}
		adapter: {
			name: 'fixture-copy-output',
			async adapt(builder) {
				builder.writeClient('deployed/client');
				builder.writeServer('deployed/server');
			}
		}
	}
};
`,
		'vite.config.js': `import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import { thirdPartyLicenses } from ${JSON.stringify(PLUGIN_ENTRY)};

export default defineConfig(() => {
	const licenses = thirdPartyLicenses();
	return {
		envDir: false,
		logLevel: 'warn',
		plugins: [sveltekit(), licenses.plugin${options.extraPlugins ? `, ${options.extraPlugins}` : ''}],
		worker: { plugins: () => [licenses.workerPlugin()] },
		ssr: { noExternal: ['server-only-marker'] }
	};
});
`,
		'src/app.html':
			'<!doctype html><html lang="en"><head>%sveltekit.head%</head><body><div>%sveltekit.body%</div></body></html>',
		'src/routes/+page.svelte': PAGE(options.extraImports ?? ''),
		'src/routes/+page.server.js':
			"import { marker } from 'server-only-marker';\nexport async function load() {\n\tconst { default: catalogue } = await import('virtual:third-party-licenses/server');\n\treturn { marker, entries: catalogue?.entries ?? null };\n}\n",
		'src/style.css': "@import 'css-marker';\n",
		'src/live.worker.js':
			"import { marker } from 'live-marker';\nimport Nested from './nested.worker.js?worker&inline';\nnew Nested();\nself.postMessage(marker);\n",
		...Object.fromEntries(
			['dead', 'inline', 'nested', 'dead-inline', 'unused-inline'].map((name) => [
				`src/${name}.worker.js`,
				`import { marker } from '${name}-marker';\nself.postMessage(marker);\n`
			])
		),
		...options.files
	});
	return root;
}

function runNode(
	root: string,
	args: string[],
	deadlineMs: number
): Promise<{ code: number | null; output: string }> {
	const env: NodeJS.ProcessEnv = { CI: '1', NO_COLOR: '1' };
	for (const key of ['PATH', 'HOME', 'TMPDIR', 'TEMP', 'TMP', 'SYSTEMROOT', 'USERPROFILE']) {
		if (process.env[key]) env[key] = process.env[key];
	}
	return new Promise((resolve, reject) => {
		const child = spawn(process.execPath, args, {
			cwd: root,
			env,
			stdio: ['ignore', 'pipe', 'pipe']
		});
		let output = '';
		child.stdout.on('data', (chunk) => (output += chunk));
		child.stderr.on('data', (chunk) => (output += chunk));
		const timer = setTimeout(() => {
			child.kill('SIGKILL');
			reject(new Error(`Fixture process exceeded ${deadlineMs} ms:\n${output.slice(-4000)}`));
		}, deadlineMs);
		child.on('error', (error) => {
			clearTimeout(timer);
			reject(error);
		});
		child.on('close', (code) => {
			clearTimeout(timer);
			resolve({ code, output });
		});
	});
}

function build(root: string) {
	return runNode(root, [VITE_BIN, 'build'], BUILD_DEADLINE_MS);
}

/**
 * Renders `/` through the server the adapter copied, in a fresh process so no
 * module the build imported can stand in for a file the copy lacks.
 */
async function renderDeployed(root: string): Promise<{ status: number; html: string }> {
	writeTree(root, {
		'render.mjs': `import { Server } from './deployed/server/index.js';
import { manifest } from './deployed/server/manifest.js';
const server = new Server(manifest);
await server.init({ env: {} });
const response = await server.respond(new Request('http://localhost/'), {
	getClientAddress: () => '127.0.0.1'
});
console.log('RENDER ' + JSON.stringify({ status: response.status, html: await response.text() }));
`
	});
	const { code, output } = await runNode(root, ['render.mjs'], RENDER_DEADLINE_MS);
	const line = output.split('\n').find((candidate) => candidate.startsWith('RENDER '));
	if (code !== 0 || !line) throw new Error(`Render failed:\n${output.slice(-4000)}`);
	return JSON.parse(line.slice('RENDER '.length));
}

/** Text of each `<pre>` notice element in the HTML, ignoring scripts and hydration data. */
function renderedNotices(html: string): string[] {
	const markup = html.replace(/<script[\s\S]*?<\/script>/gi, '');
	return Array.from(markup.matchAll(/<pre[^>]*>([^<]*)<\/pre>/g), (match) => match[1]!);
}

describe('third-party notices in a SvelteKit build', () => {
	it(
		'publishes exactly the shipped client and worker packages and server-renders them',
		async () => {
			const root = createFixture();
			const { code, output } = await build(root);
			expect(code, output).toBe(0);

			const json = readFileSync(
				path.join(root, 'deployed/client/third-party-licenses.json'),
				'utf8'
			);
			const text = readFileSync(
				path.join(root, 'deployed/client/third-party-licenses.txt'),
				'utf8'
			);
			const catalogue = v.parse(catalogueSchema, JSON.parse(json));
			const rows = Object.fromEntries(catalogue.entries.map((entry) => [entry.name, entry]));

			expect(rows['client-marker']).toMatchObject({
				components: ['client'],
				notices: [
					{ label: 'LICENSE', text: 'Client marker license' },
					{ label: 'NOTICE', text: 'Client marker attribution' }
				]
			});
			expect(rows['css-marker']?.components).toEqual(['styles']);
			// External worker, inline worker, nested inline worker, and an unused inline
			// Worker import whose bytes still ship.
			for (const name of [
				'live-marker',
				'nested-marker',
				'inline-marker',
				'unused-inline-marker'
			]) {
				expect(rows[name]?.components, name).toEqual(['client-worker']);
			}
			// Dead external worker, eliminated inline SharedWorker, CLI-only dependency,
			// and the server-only package without notices.
			for (const name of [
				'dead-marker',
				'dead-inline-marker',
				'cli-only-marker',
				'server-only-marker'
			]) {
				expect(rows[name], name).toBeUndefined();
			}
			expect(text).toContain('Client marker attribution');
			expect(text).not.toContain('server-only-marker');
			for (const published of [json, text]) {
				expect(published).not.toContain(root);
				expect(published).not.toContain(REPO_ROOT);
			}
			expect(
				existsSync(path.join(root, '.svelte-kit/output/server/third-party-licenses.json'))
			).toBe(false);

			// The deployed server renders the same notices into the HTML itself.
			const page = await renderDeployed(root);
			expect(page.status, page.html).toBe(200);
			const notices = renderedNotices(page.html);
			expect(notices).toContain('Client marker attribution');
			expect(notices).toContain('Synthetic license for live-marker');
			expect(notices).toHaveLength(
				catalogue.entries.reduce((count, entry) => count + entry.notices.length, 0)
			);
		},
		TEST_TIMEOUT_MS
	);

	it(
		'reports the original error when the build fails before the client build',
		async () => {
			const root = createFixture({
				extraPlugins:
					"{ name: 'planted-failure', buildStart() { throw new Error('Planted early failure'); } }"
			});
			const { code, output } = await build(root);
			expect(code).not.toBe(0);
			expect(output).toContain('Planted early failure');
			expect(output).not.toContain('[third-party-licenses]');
		},
		TEST_TIMEOUT_MS
	);

	it(
		'reports the original error when a later output hook fails',
		async () => {
			// The plugin removes the client catalogue and then fails, after the handoff ran.
			const root = createFixture({
				extraPlugins:
					"{ name: 'planted-late-failure', writeBundle: { order: 'post', async handler() { if (this.environment.name !== 'ssr') return; (await import('node:fs')).rmSync('.svelte-kit/output/client/third-party-licenses.json'); throw new Error('Planted late failure'); } } }"
			});
			const { code, output } = await build(root);
			expect(code).not.toBe(0);
			expect(output).toContain('Planted late failure');
			expect(output).not.toContain('[third-party-licenses]');
		},
		TEST_TIMEOUT_MS
	);

	it.each([
		[
			'browser code',
			{
				extraImports:
					"onMount(async () => console.log(await import('virtual:third-party-licenses/server')));"
			}
		],
		[
			'a worker',
			{
				extraImports: "import Leak from '../leak.worker.js?worker';\n\tconsole.log(Leak);",
				files: {
					'src/leak.worker.js':
						"import catalogue from 'virtual:third-party-licenses/server';\nself.postMessage(catalogue);\n"
				}
			}
		]
	])(
		'rejects the server catalogue module in %s',
		async (_where, options) => {
			const root = createFixture(options);
			const { code, output } = await build(root);
			expect(code).not.toBe(0);
			expect(output).toContain('virtual:third-party-licenses/server is server-only');
		},
		TEST_TIMEOUT_MS
	);

	it(
		'fails for a shipped package without primary license text',
		async () => {
			const root = createFixture({
				extraImports:
					"import { marker as bare } from 'bare-marker';\n\timport { codec } from 'primaryless-marker/codec/index.js';\n\tconsole.log(bare, codec);"
			});
			const { code, output } = await build(root);
			expect(code).not.toBe(0);
			expect(output).toContain('Third-party notices incomplete for 2 packages.');
			expect(output).toContain('bare-marker@1.0.0 [client]\n  Missing: license text');
			expect(output).toContain('primaryless-marker@1.0.0 [client]\n  Missing: license text');
			expect(existsSync(path.join(root, 'deployed/client/third-party-licenses.json'))).toBe(false);
		},
		TEST_TIMEOUT_MS
	);

	it(
		'fails when the configured service worker entry exists',
		async () => {
			const root = createFixture({
				kitFiles: "files: { serviceWorker: 'src/sw' },",
				files: { 'src/sw/index.ts': 'export {};\n' }
			});
			const { code, output } = await build(root);
			expect(code).not.toBe(0);
			expect(output).toContain(`${path.join('src', 'sw', 'index.ts')} is a service worker entry.`);
		},
		TEST_TIMEOUT_MS
	);
});
