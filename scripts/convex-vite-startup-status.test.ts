// @vitest-environment node
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

type Scenario = {
	deploySucceeds?: boolean;
	failingFunction?: string;
	statusFile?: string | null;
	mode?: string;
};

const NONCE = 'start-nonce';
const SECRET_VALUE = 'provider-secret-value';

let tempDir: string;
let originalPath: string | undefined;
let originalUserAgent: string | undefined;

function installFakeExecutables(deploySucceeds: boolean): string {
	const binDir = path.join(tempDir, 'bin');
	const cacheDir = path.join(tempDir, 'binary-cache');
	fs.mkdirSync(binDir, { recursive: true });
	fs.mkdirSync(cacheDir, { recursive: true });

	const deployScript = path.join(binDir, 'fake-pnpm.cjs');
	fs.writeFileSync(deployScript, `process.exit(${deploySucceeds ? 0 : 1});\n`);
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
		fs.writeFileSync(backendBinary, '#!/bin/sh\nsleep 5\n');
		fs.chmodSync(backendBinary, 0o755);
	}

	process.env.PATH = `${binDir}${path.delimiter}${originalPath ?? ''}`;
	process.env.npm_config_user_agent = 'pnpm/10.0.0';
	return cacheDir;
}

async function startPlugin(scenario: Scenario): Promise<string> {
	const cacheDir = installFakeExecutables(scenario.deploySucceeds ?? true);
	const statusFile =
		scenario.statusFile === undefined
			? path.join(tempDir, '.convex', 'startup-dev.json')
			: scenario.statusFile;
	const startupEnv: Record<string, string> =
		statusFile === null
			? {}
			: {
					CONVEX_STARTUP_STATUS_FILE: statusFile,
					CONVEX_STARTUP_NONCE: NONCE,
					CONVEX_STARTUP_MODE: scenario.mode ?? 'dev'
				};
	const child = spawn(
		process.execPath,
		[
			'--input-type=module',
			'--eval',
			String.raw`
				const failing = process.env.TEST_FAILING_FUNCTION;
				globalThis.fetch = async (input, init) => {
					const url = String(input);
					if (url.endsWith('/version')) return new Response(null, { status: 200 });
					if (url.endsWith('/api/v1/update_environment_variables')) {
						return new Response(null, { status: 200 });
					}
					if (url.endsWith('/api/function')) {
						const body = JSON.parse(String(init?.body));
						if (body.path === failing) return new Response('seed failed', { status: 500 });
						return Response.json({ status: 'success', value: null });
					}
					throw new Error('Unexpected local request');
				};
				const { convexLocal } = await import('convex-vite-plugin');
				const plugin = convexLocal({
					projectDir: process.env.TEST_PROJECT_DIR,
					convexDir: 'convex',
					port: 4320,
					siteProxyPort: 4321,
					instanceName: 'test',
					instanceSecret: 'instance-secret',
					adminKey: 'admin-key',
					binaryCacheDir: process.env.TEST_CACHE_DIR,
					envVars: { PROVIDER_KEY: process.env.TEST_SECRET_VALUE },
					onReady: [{ name: 'seed:first' }, { name: 'seed:second' }]
				});
				plugin.configureServer({
					watcher: { add() {}, on() {} },
					httpServer: { address: () => ({ port: 5173 }), once() {} },
					config: { server: { port: 5173 } },
					resolvedUrls: null
				});
				await new Promise((resolve) => setTimeout(resolve, 2500));
				process.exit(0);
			`
		],
		{
			cwd: process.cwd(),
			env: {
				...process.env,
				...startupEnv,
				TEST_PROJECT_DIR: tempDir,
				TEST_CACHE_DIR: cacheDir,
				TEST_FAILING_FUNCTION: scenario.failingFunction ?? '',
				TEST_SECRET_VALUE: SECRET_VALUE
			},
			stdio: ['ignore', 'pipe', 'pipe']
		}
	);
	let output = '';
	child.stdout?.setEncoding('utf8');
	child.stderr?.setEncoding('utf8');
	child.stdout?.on('data', (chunk: string) => (output += chunk));
	child.stderr?.on('data', (chunk: string) => (output += chunk));
	const exitCode = await new Promise<number | null>((resolve, reject) => {
		child.once('error', reject);
		child.once('exit', resolve);
	});
	expect(exitCode, output).toBe(0);
	return output;
}

function readStatus(file = path.join(tempDir, '.convex', 'startup-dev.json')): unknown {
	return JSON.parse(fs.readFileSync(file, 'utf8'));
}

beforeEach(() => {
	tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'convex-vite-startup-status-'));
	originalPath = process.env.PATH;
	originalUserAgent = process.env.npm_config_user_agent;
});

afterEach(() => {
	process.env.PATH = originalPath;
	if (originalUserAgent === undefined) delete process.env.npm_config_user_agent;
	else process.env.npm_config_user_agent = originalUserAgent;
	fs.rmSync(tempDir, { recursive: true, force: true });
});

describe('convex-vite-plugin startup status', () => {
	it('reports success with the backend URL, nonce and mode after deploy and every seed', async () => {
		await startPlugin({});

		expect(readStatus()).toEqual({
			outcome: 'success',
			backendUrl: 'http://localhost:4320',
			nonce: NONCE,
			mode: 'dev'
		});
		const text = fs.readFileSync(path.join(tempDir, '.convex', 'startup-dev.json'), 'utf8');
		expect(text).not.toContain(SECRET_VALUE);
		expect(text).not.toContain('admin-key');
	});

	it('reports failure when the startup deploy fails', async () => {
		await startPlugin({ deploySucceeds: false });

		expect(readStatus()).toMatchObject({ outcome: 'failure', nonce: NONCE });
	});

	it('keeps failure when an earlier seed fails and a later one succeeds', async () => {
		await startPlugin({ failingFunction: 'seed:first' });

		expect(readStatus()).toMatchObject({ outcome: 'failure', nonce: NONCE });
	});

	it('writes no status without a status file', async () => {
		await startPlugin({ statusFile: null });

		expect(fs.existsSync(path.join(tempDir, '.convex', 'startup-dev.json'))).toBe(false);
	});

	it('refuses a status file inside src', async () => {
		const inside = path.join(tempDir, 'src', 'startup.json');
		await startPlugin({ statusFile: inside });

		expect(fs.existsSync(inside)).toBe(false);
	});

	it('refuses an unknown mode', async () => {
		await startPlugin({ mode: 'production' });

		expect(fs.existsSync(path.join(tempDir, '.convex', 'startup-dev.json'))).toBe(false);
	});
});
