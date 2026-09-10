// @vitest-environment node
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

let tempDir: string;
let eventLog: string;
let originalPath: string | undefined;
let originalUserAgent: string | undefined;

function installFakeExecutables(deploySucceeds: boolean): string {
	const binDir = path.join(tempDir, 'bin');
	const cacheDir = path.join(tempDir, 'binary-cache');
	fs.mkdirSync(binDir, { recursive: true });
	fs.mkdirSync(cacheDir, { recursive: true });

	const deployScript = path.join(binDir, 'fake-pnpm.cjs');
	fs.writeFileSync(
		deployScript,
		"const fs = require('node:fs');\n" +
			"fs.appendFileSync(process.env.FAKE_CONVEX_EVENT_LOG, 'deploy\\n');\n" +
			`process.exit(${deploySucceeds ? 0 : 1});\n`
	);
	if (process.platform === 'win32') {
		fs.writeFileSync(path.join(binDir, 'pnpm.cmd'), `@node "${deployScript}" %*\r\n`);
	} else {
		const pnpm = path.join(binDir, 'pnpm');
		fs.writeFileSync(pnpm, `#!/bin/sh\nexec "${process.execPath}" "${deployScript}" "$@"\n`);
		fs.chmodSync(pnpm, 0o755);
	}

	const binaryName = `convex-local-backend-precompiled-test${
		process.platform === 'win32' ? '.exe' : ''
	}`;
	const backendBinary = path.join(cacheDir, binaryName);
	if (process.platform === 'win32') {
		fs.copyFileSync(process.execPath, backendBinary);
	} else {
		fs.writeFileSync(backendBinary, '#!/bin/sh\nexit 0\n');
		fs.chmodSync(backendBinary, 0o755);
	}

	process.env.PATH = `${binDir}${path.delimiter}${originalPath ?? ''}`;
	process.env.npm_config_user_agent = 'pnpm/10.0.0';
	process.env.FAKE_CONVEX_EVENT_LOG = eventLog;
	return cacheDir;
}

function events(): string[] {
	return fs.existsSync(eventLog)
		? fs.readFileSync(eventLog, 'utf-8').trim().split('\n').filter(Boolean)
		: [];
}

async function startPlugin(deploySucceeds: boolean) {
	const cacheDir = installFakeExecutables(deploySucceeds);
	const child = spawn(
		process.execPath,
		[
			'--input-type=module',
			'--eval',
			String.raw`
				import fs from 'node:fs';
				const eventLog = process.env.TEST_EVENT_LOG;
				const projectDir = process.env.TEST_PROJECT_DIR;
				const cacheDir = process.env.TEST_CACHE_DIR;
				const succeeds = process.env.TEST_DEPLOY_SUCCEEDS === '1';
				if (!eventLog || !projectDir || !cacheDir) throw new Error('Missing test fixture path');
				const events = () => fs.existsSync(eventLog)
					? fs.readFileSync(eventLog, 'utf8').trim().split('\n').filter(Boolean)
					: [];
				globalThis.fetch = async (input, init) => {
					const url = String(input);
					if (url.endsWith('/version')) return new Response(null, { status: 200 });
					if (url.endsWith('/api/v1/update_environment_variables')) {
						const body = JSON.parse(String(init?.body));
						const change = body.changes[0];
						const prior = events();
						fs.appendFileSync(eventLog, 'set:' + change.name + '=' + change.value + '\n');
						if (change.value === null && !prior.includes('deploy')) {
							return new Response('provider is still required', { status: 409 });
						}
						return new Response(null, { status: 200 });
					}
					throw new Error('Unexpected local request');
				};
				const { convexLocal } = await import('convex-vite-plugin');
				const plugin = convexLocal({
					projectDir,
					convexDir: 'convex',
					port: 4310,
					siteProxyPort: 4311,
					instanceName: 'test',
					instanceSecret: 'instance-secret',
					adminKey: 'admin-key',
					binaryCacheDir: cacheDir,
					envVars: { KEEP_PROVIDER: 'configured', REMOVE_PROVIDER: null }
				});
				plugin.configureServer({
					watcher: { add() {}, on() {} },
					httpServer: { address: () => ({ port: 5173 }) },
					config: { server: { port: 5173 } },
					resolvedUrls: null
				});
				const goal = succeeds ? 3 : 2;
				const deadline = Date.now() + 3000;
				while (events().length < goal && Date.now() < deadline) {
					await new Promise((resolve) => setTimeout(resolve, 25));
				}
				if (events().length < goal) process.exitCode = 1;
			`
		],
		{
			cwd: process.cwd(),
			env: {
				...process.env,
				TEST_EVENT_LOG: eventLog,
				TEST_PROJECT_DIR: tempDir,
				TEST_CACHE_DIR: cacheDir,
				TEST_DEPLOY_SUCCEEDS: deploySucceeds ? '1' : '0'
			},
			stdio: ['ignore', 'ignore', 'pipe']
		}
	);
	let stderr = '';
	child.stderr?.setEncoding('utf8');
	child.stderr?.on('data', (chunk: string) => {
		stderr += chunk;
	});
	const exitCode = await new Promise<number | null>((resolve, reject) => {
		child.once('error', reject);
		child.once('exit', resolve);
	});
	expect(exitCode, stderr).toBe(0);
}

beforeEach(() => {
	tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'convex-vite-env-order-'));
	eventLog = path.join(tempDir, 'events.log');
	originalPath = process.env.PATH;
	originalUserAgent = process.env.npm_config_user_agent;
});

afterEach(() => {
	process.env.PATH = originalPath;
	if (originalUserAgent === undefined) delete process.env.npm_config_user_agent;
	else process.env.npm_config_user_agent = originalUserAgent;
	delete process.env.FAKE_CONVEX_EVENT_LOG;
	fs.rmSync(tempDir, { recursive: true, force: true });
});

describe('convex-vite-plugin persisted environment transition', () => {
	it('sets retained values, deploys the optional definition, then removes missing providers', async () => {
		await startPlugin(true);

		expect(events()).toEqual([
			'set:KEEP_PROVIDER=configured',
			'deploy',
			'set:REMOVE_PROVIDER=null'
		]);
	});

	it('keeps persisted provider values when the initial deploy fails', async () => {
		await startPlugin(false);

		expect(events()).toEqual(['set:KEEP_PROVIDER=configured', 'deploy']);
	});
});
