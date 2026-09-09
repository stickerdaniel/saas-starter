import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let tempDir: string;
let eventLog: string;
let originalPath: string | undefined;
let originalUserAgent: string | undefined;

function fakeServer() {
	return {
		watcher: {
			add: vi.fn(),
			on: vi.fn()
		},
		httpServer: { address: () => ({ port: 5173 }) },
		config: { server: { port: 5173 } },
		resolvedUrls: null
	};
}

function installFakeExecutables(deploySucceeds: boolean): string {
	const binDir = path.join(tempDir, 'bin');
	const cacheDir = path.join(tempDir, 'binary-cache');
	fs.mkdirSync(binDir, { recursive: true });
	fs.mkdirSync(cacheDir, { recursive: true });

	const deployScript = path.join(binDir, 'fake-bunx.cjs');
	fs.writeFileSync(
		deployScript,
		"const fs = require('node:fs');\n" +
			"fs.appendFileSync(process.env.FAKE_CONVEX_EVENT_LOG, 'deploy\\n');\n" +
			`process.exit(${deploySucceeds ? 0 : 1});\n`
	);
	if (process.platform === 'win32') {
		fs.writeFileSync(path.join(binDir, 'bunx.cmd'), `@node "${deployScript}" %*\r\n`);
	} else {
		const bunx = path.join(binDir, 'bunx');
		fs.writeFileSync(bunx, `#!/bin/sh\nexec "${process.execPath}" "${deployScript}" "$@"\n`);
		fs.chmodSync(bunx, 0o755);
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
	process.env.npm_config_user_agent = 'bun/1.3.14';
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
	const { convexLocal } = await import('convex-vite-plugin');
	const plugin = convexLocal({
		projectDir: tempDir,
		convexDir: 'convex',
		port: 4310,
		siteProxyPort: 4311,
		instanceName: 'test',
		instanceSecret: 'instance-secret',
		adminKey: 'admin-key',
		binaryCacheDir: cacheDir,
		envVars: {
			KEEP_PROVIDER: 'configured',
			REMOVE_PROVIDER: null
		}
	});

	(plugin.configureServer as (server: ReturnType<typeof fakeServer>) => void)(fakeServer());
	await vi.waitFor(() => expect(events().length).toBeGreaterThanOrEqual(deploySucceeds ? 3 : 2));
}

beforeEach(() => {
	tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'convex-vite-env-order-'));
	eventLog = path.join(tempDir, 'events.log');
	originalPath = process.env.PATH;
	originalUserAgent = process.env.npm_config_user_agent;
	vi.stubGlobal(
		'fetch',
		vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
			const url = String(input);
			if (url.endsWith('/version')) return new Response(null, { status: 200 });
			if (url.endsWith('/api/v1/update_environment_variables')) {
				const body = JSON.parse(String(init?.body)) as {
					changes: Array<{ name: string; value: string | null }>;
				};
				const change = body.changes[0]!;
				const priorEvents = events();
				fs.appendFileSync(eventLog, `set:${change.name}=${change.value}\n`);
				if (change.value === null && !priorEvents.includes('deploy')) {
					return new Response('provider is still required', { status: 409 });
				}
				return new Response(null, { status: 200 });
			}
			throw new Error(`Unexpected request: ${url}`);
		})
	);
	vi.spyOn(console, 'log').mockImplementation(() => {});
	vi.spyOn(console, 'warn').mockImplementation(() => {});
	vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
	process.env.PATH = originalPath;
	if (originalUserAgent === undefined) delete process.env.npm_config_user_agent;
	else process.env.npm_config_user_agent = originalUserAgent;
	delete process.env.FAKE_CONVEX_EVENT_LOG;
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
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
