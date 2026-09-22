import { createHash } from 'node:crypto';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:http';
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

interface RegistryPackage {
	name: string;
	version: string;
	manifest: Record<string, unknown>;
	tarball: string;
}

interface RegistryConfig {
	log: string;
	packages: RegistryPackage[];
}

const script = fileURLToPath(import.meta.url);

function digest(algorithm: 'sha1' | 'sha256' | 'sha512', data: Buffer): string {
	return createHash(algorithm)
		.update(data)
		.digest(algorithm === 'sha512' ? 'base64' : 'hex');
}

async function serveRegistry(configPath: string, readyPath: string): Promise<void> {
	const config = JSON.parse(readFileSync(configPath, 'utf8')) as RegistryConfig;
	const server = createServer((request, response) => {
		const url = new URL(request.url ?? '/', 'http://127.0.0.1');
		const tarballMatch = url.pathname.match(/^\/tarballs\/(\d+)\.tgz$/);
		let status = 404;
		let body: Buffer | string = JSON.stringify({ error: 'not_found' });
		let contentType = 'application/json';
		let packageName: string | undefined;

		if (tarballMatch) {
			const selected = config.packages[Number(tarballMatch[1])];
			if (selected) {
				status = 200;
				body = readFileSync(selected.tarball);
				contentType = 'application/octet-stream';
				packageName = selected.name;
			}
		} else if (request.method === 'POST' && url.pathname.startsWith('/-/npm/v1/security/')) {
			status = 200;
			body = '{}';
		} else {
			let decoded = '';
			try {
				decoded = decodeURIComponent(url.pathname.slice(1));
			} catch {
				decoded = '';
			}
			const index = config.packages.findIndex((candidate) => candidate.name === decoded);
			const selected = config.packages[index];
			if (selected) {
				const bytes = readFileSync(selected.tarball);
				const address = server.address();
				if (!address || typeof address === 'string')
					throw new Error('Registry address is unavailable.');
				const manifest = {
					...selected.manifest,
					dist: {
						tarball: `http://127.0.0.1:${address.port}/tarballs/${index}.tgz`,
						shasum: digest('sha1', bytes),
						integrity: `sha512-${digest('sha512', bytes)}`
					}
				};
				status = 200;
				body = JSON.stringify({
					name: selected.name,
					'dist-tags': { latest: selected.version },
					versions: { [selected.version]: manifest }
				});
				packageName = selected.name;
			}
		}

		writeFileSync(
			config.log,
			`${JSON.stringify({ method: request.method, path: url.pathname, status, packageName })}\n`,
			{ flag: 'a' }
		);
		request.resume();
		response.writeHead(status, {
			'cache-control': 'no-store',
			'content-type': contentType,
			'content-length': Buffer.byteLength(body)
		});
		if (request.method === 'HEAD') response.end();
		else response.end(body);
	});

	await new Promise<void>((resolve, reject) => {
		server.once('error', reject);
		server.listen(0, '127.0.0.1', () => {
			const address = server.address();
			if (!address || typeof address === 'string') {
				reject(new Error('Registry did not bind a TCP port.'));
				return;
			}
			writeFileSync(readyPath, `http://127.0.0.1:${address.port}`);
			resolve();
		});
	});

	const close = () => server.close();
	process.once('SIGINT', close);
	process.once('SIGTERM', close);
	await new Promise<void>((resolve) => server.once('close', resolve));
}

if (process.argv[2] === '--registry-server') {
	const configPath = process.argv[3];
	const readyPath = process.argv[4];
	if (!configPath || !readyPath) throw new Error('Registry mode requires config and ready paths.');
	await serveRegistry(configPath, readyPath);
} else {
	await testPackedPackage();
}

async function testPackedPackage(): Promise<void> {
	const root = path.resolve(path.dirname(script), '..');
	const temporary = mkdtempSync(path.join(tmpdir(), 'create-saas-starter-packed-'));
	const retainedDirectory = process.env.CREATE_SAAS_STARTER_ARTIFACT_DIR;
	const packDirectory = retainedDirectory
		? path.resolve(retainedDirectory)
		: path.join(temporary, 'pack');
	const consumer = path.join(temporary, 'consumer');
	const registryLog = path.join(temporary, 'registry.jsonl');
	let registry: ChildProcess | undefined;

	function environment(namespace: string, registryUrl: string): NodeJS.ProcessEnv {
		const home = path.join(temporary, `home-${namespace}`);
		const cache = path.join(temporary, `cache-${namespace}`);
		mkdirSync(home, { recursive: true });
		mkdirSync(cache, { recursive: true });
		const result: NodeJS.ProcessEnv = {
			PATH: process.env.PATH,
			HOME: home,
			USERPROFILE: home,
			TMPDIR: temporary,
			TEMP: temporary,
			TMP: temporary,
			XDG_CACHE_HOME: cache,
			BUN_INSTALL_CACHE_DIR: cache,
			BUN_CONFIG_REGISTRY: registryUrl,
			npm_config_registry: registryUrl,
			npm_config_cache: cache,
			npm_config_audit: 'false',
			npm_config_fund: 'false',
			npm_config_update_notifier: 'false',
			npm_config_yes: 'true',
			HUSKY: '0',
			NO_COLOR: '1',
			HTTP_PROXY: 'http://127.0.0.1:9',
			HTTPS_PROXY: 'http://127.0.0.1:9',
			ALL_PROXY: 'http://127.0.0.1:9',
			NO_PROXY: '127.0.0.1,localhost'
		};
		for (const name of ['SYSTEMROOT', 'WINDIR', 'COMSPEC', 'PATHEXT']) {
			if (process.env[name] !== undefined) result[name] = process.env[name];
		}
		delete result.NODE_PATH;
		delete result.NODE_OPTIONS;
		return result;
	}

	function writeLauncherConfig(directory: string, registryUrl: string): void {
		mkdirSync(directory, { recursive: true });
		writeFileSync(
			path.join(directory, '.npmrc'),
			`registry=${registryUrl}\naudit=false\nfund=false\nupdate-notifier=false\n`
		);
		writeFileSync(path.join(directory, 'bunfig.toml'), `[install]\nregistry = "${registryUrl}"\n`);
	}

	function run(
		command: string,
		args: string[],
		cwd: string,
		env: NodeJS.ProcessEnv
	): { stdout: string; stderr: string } {
		const result = spawnSync(command, args, {
			cwd,
			env,
			encoding: 'utf8',
			stdio: ['ignore', 'pipe', 'pipe']
		});
		if (result.status !== 0) {
			throw new Error(
				`${path.basename(command)} ${args.join(' ')} failed (${result.status}):\n${result.stdout}${result.stderr}`
			);
		}
		return { stdout: result.stdout, stderr: result.stderr };
	}

	function assertVersion(
		output: { stdout: string; stderr: string },
		version: string,
		label: string
	): void {
		const lines = `${output.stdout}\n${output.stderr}`
			.split(/\r?\n/)
			.map((line) => line.trim())
			.filter(Boolean);
		if (!lines.includes(version)) {
			throw new Error(
				`${label} did not execute create-saas-starter ${version}:\n${lines.join('\n')}`
			);
		}
	}

	async function tarballEntries(
		file: string
	): Promise<Map<string, { data: Buffer; mode: number }>> {
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

	async function localDependencyFixtures(): Promise<{
		packages: RegistryPackage[];
		overrides: Record<string, string>;
	}> {
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
				peerDependencies?: Record<string, string>;
			};
			for (const dependency of Object.keys({
				...manifest.dependencies,
				...manifest.optionalDependencies,
				...manifest.peerDependencies
			})) {
				try {
					findInstalledPackage(dependency);
					pending.push(dependency);
				} catch {
					// Optional and platform-specific packages may not exist in this installation.
				}
			}
		}

		const fixtureRoot = path.join(temporary, 'dependency-fixtures');
		mkdirSync(fixtureRoot);
		const packages: RegistryPackage[] = [];
		const overrides: Record<string, string> = {};
		for (const [name, directory] of directories) {
			const safeName = name.replaceAll('/', '__').replaceAll('@', 'scope-');
			const staging = path.join(fixtureRoot, `${safeName}-package`);
			const tarball = path.join(fixtureRoot, `${safeName}.tgz`);
			cpSync(directory, staging, { recursive: true, dereference: true });
			rmSync(path.join(staging, 'node_modules'), { recursive: true, force: true });
			const manifestPath = path.join(staging, 'package.json');
			const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown> & {
				version?: string;
			};
			delete manifest.devDependencies;
			writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
			await create(
				{ cwd: staging, file: tarball, gzip: true, portable: true, prefix: 'package/' },
				readdirSync(staging)
			);
			if (typeof manifest.version !== 'string') {
				throw new Error(`Packed fixture dependency has no version: ${name}`);
			}
			packages.push({ name, version: manifest.version, manifest, tarball });
			overrides[name] = `file:${tarball}`;
		}
		return { packages, overrides };
	}

	async function waitForRegistry(readyPath: string, child: ChildProcess): Promise<string> {
		for (let attempt = 0; attempt < 500; attempt++) {
			if (existsSync(readyPath)) return readFileSync(readyPath, 'utf8');
			if (child.exitCode !== null)
				throw new Error(`Loopback registry exited with ${child.exitCode}.`);
			await new Promise((resolve) => setTimeout(resolve, 20));
		}
		throw new Error('Loopback registry did not become ready.');
	}

	async function stopRegistry(child: ChildProcess): Promise<void> {
		if (child.exitCode !== null) return;
		child.kill();
		await Promise.race([
			new Promise<void>((resolve) => child.once('exit', () => resolve())),
			new Promise<void>((resolve) => setTimeout(resolve, 5_000))
		]);
		if (child.exitCode === null) child.kill('SIGKILL');
	}

	function creatorMetadataRequests(): number {
		if (!existsSync(registryLog)) return 0;
		return readFileSync(registryLog, 'utf8')
			.split('\n')
			.filter(Boolean)
			.map((line) => JSON.parse(line) as { packageName?: string; status: number })
			.filter((entry) => entry.packageName === 'create-saas-starter' && entry.status === 200)
			.length;
	}

	try {
		mkdirSync(packDirectory, { recursive: true });
		if (readdirSync(packDirectory).length !== 0) {
			throw new Error(`Packed artifact directory must start empty: ${packDirectory}`);
		}
		mkdirSync(consumer);

		const packageManifest = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')) as {
			name: string;
			version: string;
			private: boolean;
			bin: Record<string, string>;
			dependencies: Record<string, string>;
		};
		run(
			process.execPath,
			['pm', 'pack', '--destination', packDirectory],
			root,
			environment('pack', 'http://127.0.0.1:9')
		);
		const tarballs = readdirSync(packDirectory).filter((name) => name.endsWith('.tgz'));
		if (tarballs.length !== 1) {
			throw new Error(`Expected one packed tarball, found ${tarballs.length}.`);
		}
		const tarball = path.join(packDirectory, tarballs[0]!);
		const originalHash = digest('sha256', readFileSync(tarball));
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
		const packedManifest = JSON.parse(
			entries.get('package/package.json')!.data.toString('utf8')
		) as typeof packageManifest;
		if (
			packedManifest.name !== packageManifest.name ||
			packedManifest.version !== packageManifest.version ||
			packedManifest.private !== false ||
			packedManifest.bin['create-saas-starter'] !== 'dist/index.js' ||
			JSON.stringify(packedManifest.dependencies) !== JSON.stringify(packageManifest.dependencies)
		) {
			throw new Error('Packed package metadata does not match the release contract.');
		}
		const executable = entries.get('package/dist/index.js')!;
		if (!executable.data.toString('utf8').startsWith('#!/usr/bin/env node\n')) {
			throw new Error('Packed executable is missing the Node shebang.');
		}
		if ((executable.mode & 0o111) === 0) throw new Error('Packed executable is not executable.');
		if (
			!entries
				.get('package/LICENSE')!
				.data.toString('utf8')
				.includes('Permission is hereby granted')
		) {
			throw new Error('Packed package does not contain the complete MIT license.');
		}
		const runnerHash = digest('sha256', entries.get('package/dist/windows-job-runner.ps1')!.data);
		const canonicalRunnerHash = digest(
			'sha256',
			readFileSync(path.resolve(root, '../../scripts/windows-job-runner.ps1'))
		);
		if (runnerHash !== canonicalRunnerHash) {
			throw new Error('Packed Windows runner is not canonical.');
		}
		writeFileSync(`${tarball}.sha256`, `${originalHash}  ${path.basename(tarball)}\n`);

		const dependencyFixtures = await localDependencyFixtures();
		writeFileSync(
			path.join(consumer, 'package.json'),
			`${JSON.stringify(
				{
					name: 'packed-consumer',
					private: true,
					dependencies: {
						'create-saas-starter': `file:${tarball}`,
						...dependencyFixtures.overrides
					},
					overrides: dependencyFixtures.overrides
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
			path.join(temporary, 'consumer-cache')
		];
		run(
			process.execPath,
			installArgs,
			consumer,
			environment('consumer-install', 'http://127.0.0.1:9')
		);
		rmSync(path.join(consumer, 'node_modules'), { recursive: true });
		run(
			process.execPath,
			[...installArgs, '--frozen-lockfile'],
			consumer,
			environment('consumer-frozen-install', 'http://127.0.0.1:9')
		);
		const installed = path.join(consumer, 'node_modules/create-saas-starter/dist/index.js');
		assertVersion(
			run('node', [installed, '--version'], consumer, environment('node', 'http://127.0.0.1:9')),
			packageManifest.version,
			'Node'
		);
		assertVersion(
			run(
				process.execPath,
				[installed, '--version'],
				consumer,
				environment('bun', 'http://127.0.0.1:9')
			),
			packageManifest.version,
			'Bun'
		);
		const help = run(
			'node',
			[installed, '--help'],
			consumer,
			environment('help', 'http://127.0.0.1:9')
		);
		if (!help.stdout.includes('Existing paths are never overwritten.')) {
			throw new Error('Installed CLI help is incomplete.');
		}

		const registryConfig = path.join(temporary, 'registry-config.json');
		const registryReady = path.join(temporary, 'registry-ready');
		writeFileSync(
			registryConfig,
			JSON.stringify({
				log: registryLog,
				packages: [
					{
						name: packageManifest.name,
						version: packageManifest.version,
						manifest: packedManifest,
						tarball
					},
					...dependencyFixtures.packages
				]
			} satisfies RegistryConfig)
		);
		registry = spawn(
			process.execPath,
			[script, '--registry-server', registryConfig, registryReady],
			{
				env: environment('registry', 'http://127.0.0.1:9'),
				stdio: ['ignore', 'pipe', 'pipe']
			}
		);
		const registryUrl = await waitForRegistry(registryReady, registry);

		const npxDirectory = path.join(temporary, 'launcher-npx');
		writeLauncherConfig(npxDirectory, registryUrl);
		assertVersion(
			run(
				'npx',
				['--yes', '--package', tarball, 'create-saas-starter', '--version'],
				npxDirectory,
				environment('npx', registryUrl)
			),
			packageManifest.version,
			'npx local tarball launcher'
		);

		const npmDirectory = path.join(temporary, 'launcher-npm-create');
		writeLauncherConfig(npmDirectory, registryUrl);
		const npmRequestsBefore = creatorMetadataRequests();
		assertVersion(
			run(
				'npm',
				['create', 'saas-starter', '--', '--version'],
				npmDirectory,
				environment('npm-create', registryUrl)
			),
			packageManifest.version,
			'npm create saas-starter'
		);
		if (creatorMetadataRequests() <= npmRequestsBefore) {
			throw new Error('npm create did not resolve create-saas-starter from the loopback registry.');
		}

		const bunDirectory = path.join(temporary, 'launcher-bun-create');
		writeLauncherConfig(bunDirectory, registryUrl);
		const bunRequestsBefore = creatorMetadataRequests();
		assertVersion(
			run(
				process.execPath,
				['create', 'saas-starter', '--version'],
				bunDirectory,
				environment('bun-create', registryUrl)
			),
			packageManifest.version,
			'bun create saas-starter'
		);
		if (creatorMetadataRequests() <= bunRequestsBefore) {
			throw new Error('bun create did not resolve create-saas-starter from the loopback registry.');
		}

		if (digest('sha256', readFileSync(tarball)) !== originalHash) {
			throw new Error('Packed tarball changed after inspection.');
		}
		statSync(`${tarball}.sha256`);
		console.log(`Packed launcher test passed for ${path.basename(tarball)} (${originalHash}).`);
	} finally {
		if (registry) await stopRegistry(registry);
		rmSync(temporary, { recursive: true, force: true });
	}
}
