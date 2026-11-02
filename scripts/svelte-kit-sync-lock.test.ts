import { spawn, spawnSync } from 'node:child_process';
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
import { svelteKitSyncLockPath, withSvelteKitSyncLock } from './svelte-kit-sync-lock';
import { testExecutable } from './test-executable';

const BUN = testExecutable('bun');
const MODULE = pathToFileURL(
	path.join(path.dirname(fileURLToPath(import.meta.url)), 'svelte-kit-sync-lock.ts')
).href;

/** A process that syncs `root` through the lock, as another static-check run would. */
const HOLDER = `
import { writeFileSync } from 'node:fs';
import { withSvelteKitSyncLock, withSvelteKitSyncLockSync } from ${JSON.stringify(MODULE)};
const [mode, root, marker] = process.argv.slice(2);
if (mode === 'sync') {
	await withSvelteKitSyncLock(
		root,
		() => writeFileSync(marker + '.ran', ''),
		() => writeFileSync(marker + '.waiting', '')
	);
} else {
	withSvelteKitSyncLockSync(root, () => process.exit(3));
}
`;

const scratches: Array<{ directory: string; root: string }> = [];

/** A checkout stand-in outside the repository, with the holder script beside it. */
function scratch() {
	const directory = mkdtempSync(path.join(tmpdir(), 'svelte-kit-sync-lock-'));
	const root = path.join(directory, 'checkout');
	mkdirSync(root);
	scratches.push({ directory, root });
	const holder = path.join(directory, 'holder.ts');
	writeFileSync(holder, HOLDER);
	return { root, holder, marker: path.join(directory, 'marker') };
}

async function waitFor(condition: () => boolean, what: string) {
	const deadline = Date.now() + 20_000;
	while (!condition()) {
		if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}.`);
		await new Promise((resolve) => setTimeout(resolve, 20));
	}
}

/** The pid of a process that has already exited. */
function exitedPid(): number {
	return spawnSync(BUN, ['-e', '0']).pid!;
}

afterEach(() => {
	for (const { directory, root } of scratches.splice(0)) {
		// The lock lives in the system temp directory, not in the checkout.
		const lockPath = svelteKitSyncLockPath(root);
		rmSync(lockPath, { force: true });
		rmSync(`${lockPath}.reclaim`, { force: true });
		rmSync(directory, { recursive: true, force: true });
	}
});

describe('SvelteKit sync lock', () => {
	it('makes a second process wait until the first has synced the checkout', async () => {
		const { root, holder, marker } = scratch();
		let exited: Promise<number | null> | undefined;

		await withSvelteKitSyncLock(root, async () => {
			const child = spawn(BUN, [holder, 'sync', root, marker], { stdio: 'inherit' });
			exited = new Promise((resolve) => child.on('close', resolve));
			await waitFor(() => existsSync(`${marker}.waiting`), 'the second process to wait');
			// Long enough for many polls: the second process must still be waiting.
			await new Promise((resolve) => setTimeout(resolve, 300));
			expect(existsSync(`${marker}.ran`)).toBe(false);
		});

		expect(await exited).toBe(0);
		expect(existsSync(`${marker}.ran`)).toBe(true);
		expect(existsSync(svelteKitSyncLockPath(root))).toBe(false);
	}, 30_000);

	// The waits below are asynchronous so that a regression times out instead of blocking the
	// worker forever.
	it('takes over a lock whose holder has exited', async () => {
		const { root } = scratch();
		writeFileSync(svelteKitSyncLockPath(root), String(exitedPid()));

		expect(await withSvelteKitSyncLock(root, () => 'synced')).toBe('synced');
	}, 10_000);

	it('leaves an abandoned lock to the waiter that is already reclaiming it', async () => {
		const { root } = scratch();
		const lockPath = svelteKitSyncLockPath(root);
		const holder = String(exitedPid());
		writeFileSync(lockPath, holder);
		writeFileSync(`${lockPath}.reclaim`, '');
		let synced = false;

		const pending = withSvelteKitSyncLock(root, () => (synced = true));
		await new Promise((resolve) => setTimeout(resolve, 300));
		// Removing the lock now could remove a fresh one the reclaiming waiter just created.
		expect(synced).toBe(false);
		expect(readFileSync(lockPath, 'utf8')).toBe(holder);

		rmSync(`${lockPath}.reclaim`);
		await pending;
		expect(synced).toBe(true);
	}, 10_000);

	it('does not wait forever for a reclaim marker its waiter left behind', async () => {
		const { root } = scratch();
		const lockPath = svelteKitSyncLockPath(root);
		writeFileSync(lockPath, String(exitedPid()));
		writeFileSync(`${lockPath}.reclaim`, '');
		const minuteAgo = new Date(Date.now() - 60_000);
		utimesSync(`${lockPath}.reclaim`, minuteAgo, minuteAgo);

		expect(await withSvelteKitSyncLock(root, () => 'synced')).toBe('synced');
	}, 10_000);

	it('releases the lock when its holder ends the process inside it', () => {
		const { root, holder, marker } = scratch();

		expect(spawnSync(BUN, [holder, 'exit', root, marker]).status).toBe(3);
		expect(existsSync(svelteKitSyncLockPath(root))).toBe(false);
	});

	it('lets separate checkouts sync at the same time', async () => {
		const first = scratch();
		const second = scratch();

		await withSvelteKitSyncLock(first.root, async () => {
			expect(await withSvelteKitSyncLock(second.root, () => 'synced')).toBe('synced');
		});
	}, 10_000);
});
