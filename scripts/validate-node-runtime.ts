/** Run with Node inside the isolated image, never the repository dependency tree. */
import { createHash } from 'node:crypto';
import type { Node } from 'typescript';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

export function inventory(directory: string): Record<string, string> {
	const result: Record<string, string> = {};
	function visit(current: string) {
		for (const entry of readdirSync(current, { withFileTypes: true })) {
			const file = join(current, entry.name);
			if (entry.isDirectory()) visit(file);
			else
				result[relative(directory, file).replaceAll('\\', '/')] = createHash('sha256')
					.update(readFileSync(file))
					.digest('hex');
		}
	}
	visit(directory);
	return result;
}

export function verifyInventory(expected: Record<string, string>, actual: Record<string, string>) {
	if (!Object.keys(expected).length) throw new Error('Empty builder inventory');
	for (const [file, hash] of Object.entries(expected)) {
		if (actual[file] !== hash) throw new Error(`Missing or changed runtime asset: ${file}`);
	}
	for (const file of Object.keys(actual)) {
		if (!(file in expected)) throw new Error(`Unexpected runtime asset: ${file}`);
	}
}

async function validate(revision: string, origin: string) {
	if (process.release.name !== 'node' || process.getuid?.() === 0) {
		throw new Error('Validation requires a non-root Node process');
	}
	const expected = JSON.parse(readFileSync('runtime-inventory.json', 'utf8')) as Record<
		string,
		string
	>;
	verifyInventory(expected, inventory('build'));
	const serverModules = Object.keys(expected).filter(
		(file) => file.startsWith('server/') && file.endsWith('.js')
	);
	// adapter-node 6 emits its listening entry under server/. Imported here, it would serve
	// on this process's HOST/PORT, take the port from the server spawned below, and keep
	// this probe alive after validation. Load every module in a process that then exits.
	const loading = spawnSync(
		process.execPath,
		[
			'--input-type=module',
			'-e',
			`
			import { pathToFileURL } from 'node:url';
			import { resolve } from 'node:path';
			import { readFileSync } from 'node:fs';
			for (const file of JSON.parse(readFileSync(0, 'utf8'))) {
				await import(pathToFileURL(resolve('build', file)).href);
			}
			process.exit(0);
		`
		],
		{
			encoding: 'utf8',
			env: { ...process.env, HOST: '127.0.0.1', PORT: '0' },
			input: JSON.stringify(serverModules),
			timeout: 60_000
		}
	);
	if (loading.status !== 0)
		throw new Error(`Server modules failed to load: ${loading.error?.message || loading.stderr}`);
	const imports = JSON.parse(readFileSync('runtime-imports.json', 'utf8')) as {
		literal: Array<{ issuer: string; specifier: string }>;
		computed: string[];
	};
	// Node's issuer-relative ESM resolver checks package exports and literal dynamic imports.
	const resolution = spawnSync(
		process.execPath,
		[
			'--experimental-import-meta-resolve',
			'--input-type=module',
			'-e',
			`
		import { pathToFileURL } from 'node:url';
		import { resolve } from 'node:path';
		import { readFileSync } from 'node:fs';
		for (const {issuer, specifier} of JSON.parse(readFileSync(0, 'utf8'))) {
			const target = import.meta.resolve(specifier, pathToFileURL(resolve('build', issuer)).href);
			await import(target);
		}
		process.exit(0);
	`
		],
		{
			encoding: 'utf8',
			env: { ...process.env, HOST: '127.0.0.1', PORT: '0' },
			input: JSON.stringify(imports.literal),
			timeout: 60_000
		}
	);
	if (resolution.status !== 0)
		throw new Error(
			`Node import closure failed: ${resolution.error?.message || resolution.stderr}`
		);
	const server = spawn(process.execPath, ['build'], {
		env: { ...process.env, ORIGIN: origin, HOST: '127.0.0.1', PORT: '3000' },
		stdio: ['ignore', 'pipe', 'pipe']
	});
	let output = '';
	server.stdout.on('data', (chunk) => {
		output += String(chunk);
	});
	server.stderr.on('data', (chunk) => {
		output += String(chunk);
	});
	const stopped = new Promise<void>((done) => server.once('exit', () => done()));
	try {
		const url = 'http://127.0.0.1:3000';
		for (let attempt = 0; ; attempt++) {
			try {
				await fetch(url, { signal: AbortSignal.timeout(1000) });
				break;
			} catch {
				if (attempt >= 60 || server.exitCode !== null)
					throw new Error(`Node startup failed: ${output}`);
				await delay(250);
			}
		}
		for (const route of ['/en', '/en/signin', '/en/pricing']) {
			const response = await fetch(url + route, { signal: AbortSignal.timeout(10_000) });
			if (response.status !== 200 || !response.headers.get('content-type')?.includes('text/html'))
				throw new Error(`SSR failed: ${route} (${response.status})`);
			if (!(await response.text()).includes('<html')) throw new Error(`Empty SSR: ${route}`);
		}
		const protectedResponse = await fetch(url + '/en/app', {
			redirect: 'manual',
			signal: AbortSignal.timeout(10_000)
		});
		if (
			protectedResponse.status !== 307 ||
			!protectedResponse.headers.get('location')?.includes('/en/signin?')
		)
			throw new Error('Protected route did not redirect');
		const version = (await (await fetch(url + '/_app/version.json')).json()) as { version: string };
		if (version.version !== revision) throw new Error(`Wrong served revision: ${version.version}`);
		// Fetch public assets as served; the builder inventory also checks compressed copies.
		const assets = Object.keys(expected).filter(
			(file) =>
				file.startsWith('client/') &&
				!file.split('/').some((part) => part.startsWith('.')) &&
				!/\.(br|gz)$/.test(file)
		);
		for (const file of assets) {
			const response = await fetch(url + '/' + file.slice('client/'.length), {
				signal: AbortSignal.timeout(10_000)
			});
			const hash = createHash('sha256')
				.update(Buffer.from(await response.arrayBuffer()))
				.digest('hex');
			if (response.status !== 200 || hash !== expected[file])
				throw new Error(`Served asset differs: ${file} (${response.status})`);
		}
		// The answers above must come from the spawned server, not something else on the port.
		if (server.exitCode !== null) throw new Error(`Node server exited early: ${output}`);
		// adapter-node exits on SIGTERM only once nothing else holds the event loop. A
		// connection opened during server rendering would keep a deployment from stopping.
		server.kill('SIGTERM');
		await Promise.race([stopped, delay(5000)]);
		if (server.exitCode === null && server.signalCode === null)
			throw new Error(`Node server did not exit after SIGTERM: ${output}`);
		if (server.exitCode !== 0 || server.signalCode !== null)
			throw new Error(
				`Node server shutdown failed (exit ${server.exitCode}, signal ${server.signalCode}): ${output}`
			);
		console.log(
			JSON.stringify({
				node: process.version,
				architecture: process.arch,
				uid: process.getuid?.(),
				modules: serverModules.length,
				literalImports: imports.literal.length,
				computedImportSites: imports.computed,
				assets: assets.length,
				files: Object.keys(expected).length,
				revision
			})
		);
	} finally {
		if (server.exitCode === null && server.signalCode === null) {
			server.kill('SIGKILL');
			await stopped;
		}
	}
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
	if (process.argv[2] === 'inventory') {
		const files = inventory('build');
		writeFileSync('runtime-inventory.json', JSON.stringify(files));
		const ts = await import('typescript');
		const literal: Array<{ issuer: string; specifier: string }> = [];
		const computed: string[] = [];
		for (const issuer of Object.keys(files).filter(
			(file) => file.startsWith('server/') && file.endsWith('.js')
		)) {
			const source = ts.createSourceFile(
				issuer,
				readFileSync(join('build', issuer), 'utf8'),
				ts.ScriptTarget.Latest,
				true,
				ts.ScriptKind.JS
			);
			function visit(node: Node) {
				if (
					(ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
					node.moduleSpecifier &&
					ts.isStringLiteral(node.moduleSpecifier)
				)
					literal.push({ issuer, specifier: node.moduleSpecifier.text });
				if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
					const argument = node.arguments[0];
					if (argument && ts.isStringLiteralLike(argument))
						literal.push({ issuer, specifier: argument.text });
					else
						computed.push(
							`${issuer}:${source.getLineAndCharacterOfPosition(node.getStart()).line + 1}`
						);
				}
				ts.forEachChild(node, visit);
			}
			visit(source);
		}
		writeFileSync('runtime-imports.json', JSON.stringify({ literal, computed }));
	} else {
		const [revision, origin] = process.argv.slice(2);
		if (!revision || !origin)
			throw new Error('Usage: node validate-node-runtime.ts <revision> <origin>');
		await validate(revision, origin);
	}
}
