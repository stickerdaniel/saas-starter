import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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
await withCheckoutLock(
	root,
	() => writeFileSync(marker + '.ran', ''),
	() => writeFileSync(marker + '.waiting', '')
);
`;

const scratches: Array<{ directory: string; root: string }> = [];

function scratch() {
	const directory = mkdtempSync(path.join(tmpdir(), 'checkout-lock-'));
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

function exitedPid(): number {
	const pid = spawnSync(BUN, ['-e', '0']).pid;
	if (pid === undefined) throw new Error('bun did not start.');
	return pid;
}

afterEach(() => {
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
			const child = spawn(BUN, [holder, root, marker], { stdio: 'inherit' });
			exited = new Promise((resolve) => child.on('close', resolve));
			await waitFor(() => existsSync(`${marker}.waiting`), 'the second process to wait');
			await new Promise((resolve) => setTimeout(resolve, 300));
			expect(existsSync(`${marker}.ran`)).toBe(false);
		});

		expect(await exited).toBe(0);
		expect(existsSync(`${marker}.ran`)).toBe(true);
		expect(existsSync(checkoutLockPath(root))).toBe(false);
	}, 30_000);

	it('takes over a lock whose holder pid is gone', async () => {
		const { root } = scratch();
		writeFileSync(checkoutLockPath(root), String(exitedPid()));

		expect(await withCheckoutLock(root, () => 'ran')).toBe('ran');
	}, 10_000);

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
});
