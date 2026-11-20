import { once } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { type BackendExit, ConvexBackend } from 'convex-vite-plugin/lib';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { recordTestBackendExit, watchTestBackendExit } from './test-backend-exit';

const version = 'precompiled-test';
const tempRoots: string[] = [];

const fakeBackend = [
	'#!/bin/sh',
	String.raw`printf '\033[32m INFO\033[0m probe backend serving\n'`,
	`printf 'probe stderr line\\n' >&2`,
	'exec sleep 30'
].join('\n');

async function startBackend(onExit: (exit: BackendExit) => void) {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'convex-vite-exit-'));
	tempRoots.push(root);
	const cacheDir = path.join(root, 'cache');
	fs.mkdirSync(cacheDir);
	fs.writeFileSync(path.join(cacheDir, `convex-local-backend-${version}`), fakeBackend, {
		mode: 0o755
	});
	const stateDir = path.join(root, 'state');
	fs.mkdirSync(stateDir);
	const backend = new ConvexBackend(
		{
			binaryCacheDir: cacheDir,
			binaryVersion: version,
			projectDir: root,
			stdio: 'ignore',
			instanceSecret: 'test-secret',
			adminKey: 'test-admin-key',
			onExit
		},
		'silent'
	);
	await backend.spawn(stateDir);
	const child = backend.process!;
	const exited = once(child, 'exit');
	await vi.waitFor(() =>
		expect(fs.readFileSync(path.join(stateDir, 'backend.log'), 'utf8')).toContain('stderr')
	);
	return { backend, child, exited };
}

afterEach(() => {
	for (const root of tempRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe.skipIf(process.platform === 'win32')('convex-vite-plugin backend exit', () => {
	it('reports the signal and the last backend output', async () => {
		const exit = Promise.withResolvers<BackendExit>();
		const { child } = await startBackend(exit.resolve);

		process.kill(child.pid!, 'SIGSEGV');

		const { code, signal, output } = await exit.promise;
		expect({ code, signal }).toEqual({ code: null, signal: 'SIGSEGV' });
		expect(output).toContain('INFO probe backend serving');
		expect(output).toContain('probe stderr line');
	}, 5_000);

	it('stays silent when stop() ends the backend', async () => {
		const onExit = vi.fn();
		const { backend, exited } = await startBackend(onExit);

		await backend.stop(false);
		await exited;
		await new Promise((resolve) => setTimeout(resolve, 300));

		expect(onExit).not.toHaveBeenCalled();
	});
});

describe('test backend exit file', () => {
	it('hands the recorded exit to the watcher once', async () => {
		const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'test-backend-exit-'));
		tempRoots.push(cwd);
		fs.mkdirSync(path.join(cwd, '.convex'));
		const onExit = vi.fn();
		const stop = watchTestBackendExit(onExit, { cwd, intervalMs: 10 });

		recordTestBackendExit(new Error('Convex backend exited unexpectedly with signal SIGSEGV'), cwd);

		await vi.waitFor(() =>
			expect(onExit).toHaveBeenCalledWith('Convex backend exited unexpectedly with signal SIGSEGV')
		);
		await new Promise((resolve) => setTimeout(resolve, 50));
		stop();
		expect(onExit).toHaveBeenCalledTimes(1);
	});
});
