/**
 * Builds and serves the app with a fixture docs catalog, apart from the ordinary build.
 *
 * Usage:
 *   bun scripts/docs-fixture.ts build [--variant published|foreign-site|empty]
 *   bun scripts/docs-fixture.ts serve [--port <port>]
 *
 * The build runs the repository's `prebuild` script, then Vite's JavaScript API with
 * scripts/docs-fixture.vite.config.ts: vite.config.ts for adapter-node plus one plugin that
 * resolves `src/lib/docs/catalog.ts` and `src/lib/docs/source.server.ts` to the fixture in
 * src/lib/docs/__fixtures__/. Kit output, adapter output and the client module graph go below
 * `.svelte-kit/docs-fixture/`, and both postbuild guards check that output. `serve` starts the
 * built Node server on loopback.
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { createBuilder } from 'vite';
import { loadBuildEnvironment, resolveBuildSiteOrigin } from './build';
import { findAvailablePort } from './dev-ports';

const root = path.resolve(import.meta.dirname, '..');
const fixtureRoot = path.join(root, '.svelte-kit', 'docs-fixture');
export const fixtureKitOutput = path.join(fixtureRoot, 'kit', 'output');
export const fixtureServerDir = path.join(fixtureRoot, 'node');
const FIXTURE_SITE_URL = 'http://localhost:4173';

export const VARIANTS = {
	published: 'publishedCatalog',
	'foreign-site': 'foreignSiteCatalog',
	empty: 'emptyCatalog'
} as const;
export type Variant = keyof typeof VARIANTS;

export function isVariant(value: string): value is Variant {
	return Object.hasOwn(VARIANTS, value);
}

const FIXTURE_VARIABLES = ['NODE_ADAPTER', 'NODE_ENV', 'DOCS_FIXTURE_VARIANT', 'PUBLIC_SITE_URL'];

function filesBelow(dir: string): string[] {
	if (!fs.existsSync(dir)) return [];
	return fs
		.readdirSync(dir, { recursive: true, withFileTypes: true })
		.filter((entry) => entry.isFile())
		.map((entry) => path.join(entry.parentPath, entry.name));
}

/**
 * Runs `work`, then gives the environment variables `keys` their earlier values (or unsets
 * them) and gives `dir` its earlier files with their earlier content, also when `work` throws.
 */
export async function restoring<T>(
	keys: readonly string[],
	dir: string,
	work: () => Promise<T>
): Promise<T> {
	const variables = keys.map((key) => [key, process.env[key]] as const);
	const existed = fs.existsSync(dir);
	const saved = new Map(filesBelow(dir).map((file) => [file, fs.readFileSync(file)]));
	try {
		return await work();
	} finally {
		for (const [key, value] of variables) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
		if (!existed) fs.rmSync(dir, { recursive: true, force: true });
		for (const file of filesBelow(dir)) if (!saved.has(file)) fs.rmSync(file);
		for (const [file, content] of saved) {
			fs.mkdirSync(path.dirname(file), { recursive: true });
			fs.writeFileSync(file, content);
		}
	}
}

function run(label: string, command: string, args: string[]): void {
	const result = spawnSync(command, args, { cwd: root, stdio: 'inherit' });
	if (result.status !== 0) {
		throw new Error(`${label} exited with ${result.status ?? result.signal}`);
	}
}

/** The configured site origin, or the fixture's own when both variables are unset or empty. */
export function fixtureSite(environment = loadBuildEnvironment([], process.env, root)): string {
	return resolveBuildSiteOrigin({
		...environment,
		NODE_ADAPTER: '1',
		PUBLIC_SITE_URL: environment.PUBLIC_SITE_URL || environment.SITE_URL || FIXTURE_SITE_URL
	});
}

/**
 * Builds the fixture app and checks its output; returns the site origin the build holds. Kit
 * writes `node_modules/$app` for the outDir of the build it runs, which editors and
 * svelte-check read for the ordinary tree, so the ordinary files return afterwards.
 */
export async function buildFixture(variant: Variant): Promise<string> {
	const site = fixtureSite();
	await restoring(FIXTURE_VARIABLES, path.join(root, 'node_modules', '$app'), async () => {
		run('prebuild', 'bun', ['run', 'prebuild']);
		Object.assign(process.env, {
			NODE_ADAPTER: '1',
			NODE_ENV: 'production',
			DOCS_FIXTURE_VARIANT: variant,
			PUBLIC_SITE_URL: site
		});
		const builder = await createBuilder({
			configFile: path.join(root, 'scripts', 'docs-fixture.vite.config.ts'),
			mode: 'production'
		});
		await builder.buildApp();
		run('check-build-output', 'bun', [
			'scripts/check-build-output.ts',
			'--output-root',
			fixtureKitOutput,
			'--docs-fixture'
		]);
		run('check-bundle-budget', 'bun', [
			'scripts/check-bundle-budget.ts',
			'--output-root',
			fixtureKitOutput
		]);
	});
	return site;
}

/** Starts the built fixture server on loopback; the caller stops it by its PID. */
export async function serveFixture(
	port?: number
): Promise<{ server: ChildProcess; origin: string }> {
	const listenPort = port ?? (await findAvailablePort(4180));
	const origin = `http://127.0.0.1:${listenPort}`;
	const server = spawn('node', [path.join(fixtureServerDir, 'index.js')], {
		cwd: root,
		stdio: ['ignore', 'inherit', 'inherit'],
		env: {
			...process.env,
			NODE_ENV: 'production',
			PUBLIC_SITE_URL: fixtureSite(),
			HOST: '127.0.0.1',
			PORT: String(listenPort),
			ORIGIN: origin
		}
	});
	const deadline = Date.now() + 30_000;
	while (Date.now() < deadline) {
		if (server.exitCode !== null)
			throw new Error(`The fixture server exited with ${server.exitCode}`);
		try {
			await fetch(`${origin}/robots.txt`);
			return { server, origin };
		} catch {
			await new Promise((settle) => setTimeout(settle, 200));
		}
	}
	server.kill();
	throw new Error(`The fixture server did not answer on ${origin} within 30 s`);
}

if (import.meta.main) {
	const { positionals, values } = parseArgs({
		allowPositionals: true,
		options: {
			variant: { type: 'string', default: 'published' },
			port: { type: 'string' }
		}
	});
	const [command] = positionals;
	if (command === 'build' && isVariant(values.variant)) {
		await buildFixture(values.variant);
	} else if (command === 'serve') {
		const { server, origin } = await serveFixture(values.port ? Number(values.port) : undefined);
		console.log(`[docs-fixture] Serving ${origin} as PID ${server.pid}`);
		process.once('SIGINT', () => server.kill());
		process.once('SIGTERM', () => server.kill());
	} else {
		console.error(
			`Usage: bun scripts/docs-fixture.ts build [--variant ${Object.keys(VARIANTS).join('|')}] | serve [--port <port>]`
		);
		process.exit(1);
	}
}
