import { type ChildProcess, spawn, spawnSync } from 'node:child_process';
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	utimesSync,
	writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { checkoutLockPath, withCheckoutLock } from './checkout-lock';
import { testExecutable } from './test-executable';

const BUN = testExecutable('bun');
const MODULE = pathToFileURL(
	path.join(path.dirname(fileURLToPath(import.meta.url)), 'checkout-lock.ts')
).href;

const HOLDER = `
import { writeFileSync } from 'node:fs';
import { withCheckoutLock } from ${JSON.stringify(MODULE)};
const [root, marker] = process.argv.slice(2);
await withCheckoutLock(root, () => writeFileSync(marker + '.ran', ''), {
	onWait: () => writeFileSync(marker + '.waiting', '')
});
`;

const SIGNALED_HOLDER = `
import { existsSync, writeFileSync } from 'node:fs';
import { withCheckoutLock } from ${JSON.stringify(MODULE)};
const [root, marker, handled] = process.argv.slice(2);
if (handled) process.on(handled, () => writeFileSync(marker + '.signaled', ''));
await withCheckoutLock(root, async () => {
	writeFileSync(marker + '.held', '');
	while (!existsSync(marker + '.finish')) await new Promise((resolve) => setTimeout(resolve, 20));
	writeFileSync(marker + '.finished', '');
});
`;

const scratches: Array<{ directory: string; root: string }> = [];
const children: ChildProcess[] = [];

function start(...args: string[]): ChildProcess {
	const child = spawn(BUN, args, { stdio: 'inherit' });
	children.push(child);
	return child;
}

function scratch() {
	const directory = mkdtempSync(path.join(tmpdir(), 'checkout-lock-'));
	const root = path.join(directory, 'checkout');
	mkdirSync(root);
	scratches.push({ directory, root });
	const holder = path.join(directory, 'holder.ts');
	writeFileSync(holder, HOLDER);
	const signaledHolder = path.join(directory, 'signaled-holder.ts');
	writeFileSync(signaledHolder, SIGNALED_HOLDER);
	return { root, holder, signaledHolder, marker: path.join(directory, 'marker') };
}

async function waitFor(condition: () => boolean, what: string) {
	const deadline = Date.now() + 20_000;
	while (!condition()) {
		if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}.`);
		await new Promise((resolve) => setTimeout(resolve, 20));
	}
}

function exitedPid(): number {
	const pid = spawnSync(BUN, ['-e', '0']).pid;
	if (pid === undefined) throw new Error('bun did not start.');
	return pid;
}

function writeOwner(root: string, owner: string, ageMs = 0) {
	const lockPath = checkoutLockPath(root);
	writeFileSync(lockPath, owner);
	const written = new Date(Date.now() - ageMs);
	utimesSync(lockPath, written, written);
}

function exitOf(child: ChildProcess) {
	return new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) =>
		child.on('exit', (code, signal) => resolve({ code, signal }))
	);
}

afterEach(() => {
	for (const child of children.splice(0)) {
		if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
	}
	for (const { directory, root } of scratches.splice(0)) {
		const lockPath = checkoutLockPath(root);
		rmSync(lockPath, { force: true });
		rmSync(`${lockPath}.reclaim`, { force: true });
		rmSync(directory, { recursive: true, force: true });
	}
});

describe('checkout lock', () => {
	it('keeps a second process waiting until the first run has ended', async () => {
		const { root, holder, marker } = scratch();
		let exited: Promise<number | null> | undefined;

		await withCheckoutLock(root, async () => {
			const child = start(holder, root, marker);
			exited = new Promise((resolve) => child.on('close', resolve));
			await waitFor(() => existsSync(`${marker}.waiting`), 'the second process to wait');
			await new Promise((resolve) => setTimeout(resolve, 1_500));
			expect(existsSync(`${marker}.ran`)).toBe(false);
		});

		expect(await exited).toBe(0);
		expect(existsSync(`${marker}.ran`)).toBe(true);
		expect(existsSync(checkoutLockPath(root))).toBe(false);
	}, 30_000);

	it.each([
		['an incarnation', (pid: number) => JSON.stringify({ pid, incarnation: 'Thu Jan  1 1970' })],
		['a bare pid', (pid: number) => String(pid)]
	])(
		'takes over a lock with %s whose holder pid is gone',
		async (_format, owner) => {
			const { root } = scratch();
			writeOwner(root, owner(exitedPid()));

			expect(await withCheckoutLock(root, () => 'ran')).toBe('ran');
		},
		10_000
	);

	it('takes over a lock whose pid now belongs to another process', async () => {
		const { root } = scratch();
		writeOwner(root, JSON.stringify({ pid: process.pid, incarnation: 'Thu Jan  1 1970' }));

		expect(await withCheckoutLock(root, () => 'ran')).toBe('ran');
	}, 10_000);

	it.each([
		['a bare pid', String(process.pid)],
		['an empty incarnation', JSON.stringify({ pid: process.pid, incarnation: '' })]
	])(
		'leaves a live holder recorded as %s its lock',
		async (_format, owner) => {
			const { root } = scratch();
			writeOwner(root, owner, 18_000);

			await expect(
				withCheckoutLock(root, () => 'ran', { signal: AbortSignal.timeout(1_500) })
			).rejects.toMatchObject({ name: 'TimeoutError' });
			expect(readFileSync(checkoutLockPath(root), 'utf8')).toBe(owner);
		},
		10_000
	);

	it('releases the lock when the run fails', async () => {
		const { root } = scratch();

		await expect(
			withCheckoutLock(root, () => {
				throw new Error('codegen failed');
			})
		).rejects.toThrow('codegen failed');

		expect(existsSync(checkoutLockPath(root))).toBe(false);
		expect(await withCheckoutLock(root, () => 'ran')).toBe('ran');
	}, 10_000);

	it.skipIf(process.platform === 'win32')(
		'keeps a holder that handles SIGTERM itself locked until its run has finished',
		async () => {
			const { root, holder, signaledHolder, marker } = scratch();
			const waiterMarker = `${marker}-waiter`;
			const first = start(signaledHolder, root, marker, 'SIGTERM');
			const firstExit = exitOf(first);
			await waitFor(() => existsSync(`${marker}.held`), 'the holder to take the lock');

			first.kill('SIGTERM');
			await waitFor(() => existsSync(`${marker}.signaled`), 'the holder to handle SIGTERM');
			const second = start(holder, root, waiterMarker);
			const secondExit = exitOf(second);
			await waitFor(() => existsSync(`${waiterMarker}.waiting`), 'the second process to wait');
			await new Promise((resolve) => setTimeout(resolve, 1_500));

			expect(existsSync(`${waiterMarker}.ran`)).toBe(false);
			expect(existsSync(checkoutLockPath(root))).toBe(true);

			writeFileSync(`${marker}.finish`, '');

			expect(await firstExit).toEqual({ code: 0, signal: null });
			expect(await secondExit).toEqual({ code: 0, signal: null });
			expect(existsSync(`${marker}.finished`)).toBe(true);
			expect(existsSync(`${waiterMarker}.ran`)).toBe(true);
		},
		30_000
	);

	it.skipIf(process.platform === 'win32').each(['SIGINT', 'SIGTERM'] as const)(
		'ends a holder with no own %s handler by that signal once its run has finished',
		async (signal) => {
			const { root, signaledHolder, marker } = scratch();
			const child = start(signaledHolder, root, marker);
			const exited = exitOf(child);
			await waitFor(() => existsSync(`${marker}.held`), 'the holder to take the lock');

			child.kill(signal);
			await new Promise((resolve) => setTimeout(resolve, 500));

			expect(child.exitCode).toBeNull();
			expect(existsSync(checkoutLockPath(root))).toBe(true);

			writeFileSync(`${marker}.finish`, '');

			expect(await exited).toEqual({ code: null, signal });
			expect(existsSync(`${marker}.finished`)).toBe(true);
			expect(existsSync(checkoutLockPath(root))).toBe(false);
		},
		30_000
	);

	it('stops waiting when the wait is aborted', async () => {
		const { root } = scratch();
		const controller = new AbortController();
		const reason = new Error('dev server stopped');
		let ran = false;

		await withCheckoutLock(root, async () => {
			const waiting = withCheckoutLock(
				root,
				() => {
					ran = true;
				},
				{ signal: controller.signal, onWait: () => controller.abort(reason) }
			);
			await expect(waiting).rejects.toBe(reason);
			expect(existsSync(checkoutLockPath(root))).toBe(true);
		});

		expect(ran).toBe(false);
		expect(existsSync(checkoutLockPath(root))).toBe(false);
	}, 10_000);
});
