import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
	cpSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { create, list, type ReadEntry } from 'tar';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temporary = mkdtempSync(path.join(tmpdir(), 'create-saas-starter-packed-'));
const packDirectory = path.join(temporary, 'pack');
const consumer = path.join(temporary, 'consumer');
const home = path.join(temporary, 'home');
const cache = path.join(temporary, 'cache');

function environment(): NodeJS.ProcessEnv {
	const result: NodeJS.ProcessEnv = {
		PATH: process.env.PATH,
		HOME: home,
		USERPROFILE: home,
		TMPDIR: temporary,
		TEMP: temporary,
		TMP: temporary,
		HUSKY: '0',
		NO_PROXY: '127.0.0.1,localhost'
	};
	for (const name of ['SYSTEMROOT', 'WINDIR', 'COMSPEC', 'PATHEXT']) {
		if (process.env[name] !== undefined) result[name] = process.env[name];
	}
	delete result.NODE_PATH;
	return result;
}

function run(command: string, args: string[], cwd: string): string {
	const result = spawnSync(command, args, {
		cwd,
		env: environment(),
		encoding: 'utf8',
		stdio: ['ignore', 'pipe', 'pipe']
	});
	if (result.status !== 0) {
		throw new Error(
			`${path.basename(command)} ${args.join(' ')} failed (${result.status}):\n${result.stdout}${result.stderr}`
		);
	}
	return result.stdout;
}

async function tarballEntries(file: string): Promise<Map<string, { data: Buffer; mode: number }>> {
	const entries = new Map<string, { data: Buffer; mode: number }>();
	await list({
		file,
		strict: true,
		onReadEntry: (entry: ReadEntry) => {
			const chunks: Buffer[] = [];
			entry.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
			entry.on('end', () =>
				entries.set(entry.path, { data: Buffer.concat(chunks), mode: entry.mode ?? 0 })
			);
		}
	});
	return entries;
}

function findInstalledPackage(name: string): string {
	const segments = name.split('/');
	let directory = root;
	while (true) {
		const candidate = path.join(directory, 'node_modules', ...segments);
		if (existsSync(path.join(candidate, 'package.json'))) return candidate;
		const parent = path.dirname(directory);
		if (parent === directory) break;
		directory = parent;
	}
	throw new Error(`Packed fixture dependency is not installed: ${name}`);
}

async function localDependencyFixtures(): Promise<Record<string, string>> {
	const directories = new Map<string, string>();
	const pending = ['@clack/prompts', 'tar'];
	while (pending.length > 0) {
		const name = pending.pop()!;
		if (directories.has(name)) continue;
		const directory = findInstalledPackage(name);
		directories.set(name, directory);
		const manifest = JSON.parse(readFileSync(path.join(directory, 'package.json'), 'utf8')) as {
			dependencies?: Record<string, string>;
			optionalDependencies?: Record<string, string>;
		};
		for (const dependency of Object.keys({
			...manifest.dependencies,
			...manifest.optionalDependencies
		})) {
			try {
				findInstalledPackage(dependency);
				pending.push(dependency);
			} catch {
				// Optional platform packages may not be present in this fixture.
			}
		}
	}

	const fixtureRoot = path.join(temporary, 'dependency-fixtures');
	mkdirSync(fixtureRoot);
	const fixtures: Record<string, string> = {};
	for (const [name, directory] of directories) {
		const safeName = name.replaceAll('/', '__').replaceAll('@', 'scope-');
		const staging = path.join(fixtureRoot, `${safeName}-package`);
		const tarball = path.join(fixtureRoot, `${safeName}.tgz`);
		cpSync(directory, staging, { recursive: true, dereference: true });
		rmSync(path.join(staging, 'node_modules'), { recursive: true, force: true });
		const manifestPath = path.join(staging, 'package.json');
		const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>;
		delete manifest.devDependencies;
		delete manifest.scripts;
		writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
		await create(
			{ cwd: staging, file: tarball, gzip: true, portable: true, prefix: 'package/' },
			readdirSync(staging)
		);
		fixtures[name] = `file:${tarball}`;
	}
	return fixtures;
}

try {
	statSync(path.join(root, 'dist/index.js'));
	writeFileSync(path.join(temporary, '.keep'), '');
	rmSync(path.join(temporary, '.keep'));
	mkdirSync(packDirectory);
	mkdirSync(consumer);
	mkdirSync(home);
	mkdirSync(cache);

	run(process.execPath, ['pm', 'pack', '--destination', packDirectory], root);
	const tarballs = readdirSync(packDirectory).filter((name) => name.endsWith('.tgz'));
	if (tarballs.length !== 1)
		throw new Error(`Expected one packed tarball, found ${tarballs.length}.`);
	const tarball = path.join(packDirectory, tarballs[0]!);
	const entries = await tarballEntries(tarball);
	const required = [
		'package/package.json',
		'package/README.md',
		'package/LICENSE',
		'package/dist/index.js',
		'package/dist/index.js.map',
		'package/dist/windows-job-runner.ps1'
	];
	for (const name of required) {
		if (!entries.has(name)) throw new Error(`Packed tarball is missing ${name}.`);
	}
	for (const name of entries.keys()) {
		if (!/^package\/(?:package\.json|README\.md|LICENSE|dist\/)/.test(name)) {
			throw new Error(`Packed tarball contains an unpublished path: ${name}.`);
		}
	}
	const manifest = JSON.parse(entries.get('package/package.json')!.data.toString('utf8')) as {
		name: string;
		version: string;
		private: boolean;
		bin: Record<string, string>;
		dependencies: Record<string, string>;
	};
	if (
		manifest.name !== 'create-saas-starter' ||
		manifest.version !== '0.1.0' ||
		manifest.private !== false ||
		manifest.bin['create-saas-starter'] !== 'dist/index.js' ||
		JSON.stringify(manifest.dependencies) !==
			JSON.stringify({ '@clack/prompts': '1.7.0', tar: '7.5.22' })
	) {
		throw new Error('Packed package metadata does not match the release contract.');
	}
	const executable = entries.get('package/dist/index.js')!;
	if (!executable.data.toString('utf8').startsWith('#!/usr/bin/env node\n')) {
		throw new Error('Packed executable is missing the Node shebang.');
	}
	if ((executable.mode & 0o111) === 0) throw new Error('Packed executable is not executable.');
	if (
		!entries.get('package/LICENSE')!.data.toString('utf8').includes('Permission is hereby granted')
	) {
		throw new Error('Packed package does not contain the complete MIT license.');
	}
	const runnerHash = createHash('sha256')
		.update(entries.get('package/dist/windows-job-runner.ps1')!.data)
		.digest('hex');
	const canonicalRunnerHash = createHash('sha256')
		.update(readFileSync(path.resolve(root, '../../scripts/windows-job-runner.ps1')))
		.digest('hex');
	if (runnerHash !== canonicalRunnerHash)
		throw new Error('Packed Windows runner is not canonical.');

	const dependencyFixtures = await localDependencyFixtures();
	writeFileSync(
		path.join(consumer, 'package.json'),
		`${JSON.stringify(
			{
				name: 'packed-consumer',
				private: true,
				dependencies: {
					'create-saas-starter': `file:${tarball}`,
					...dependencyFixtures
				},
				overrides: dependencyFixtures
			},
			null,
			2
		)}\n`
	);
	const installArgs = [
		'install',
		'--production',
		'--registry',
		'http://127.0.0.1:9',
		'--cache-dir',
		cache
	];
	run(process.execPath, installArgs, consumer);
	rmSync(path.join(consumer, 'node_modules'), { recursive: true });
	run(process.execPath, [...installArgs, '--frozen-lockfile'], consumer);
	const installed = path.join(consumer, 'node_modules/create-saas-starter/dist/index.js');
	const version = run('node', [installed, '--version'], consumer).trim();
	if (version !== '0.1.0') throw new Error(`Installed CLI reported unexpected version ${version}.`);
	const help = run('node', [installed, '--help'], consumer);
	if (!help.includes('Existing paths are never overwritten.')) {
		throw new Error('Installed CLI help is incomplete.');
	}
	run('npx', ['--no-install', 'create-saas-starter', '--version'], consumer);
	console.log(`Packed consumer test passed for ${path.basename(tarball)}.`);
} finally {
	rmSync(temporary, { recursive: true, force: true });
}
