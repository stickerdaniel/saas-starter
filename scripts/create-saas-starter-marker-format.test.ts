import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { check, getFileInfo, resolveConfig } from 'prettier';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SCAFFOLD_MARKER } from '../packages/create-saas-starter/src/archive.js';
import {
	claimTarget,
	createStagingTarget,
	initialMarker,
	inspectTarget,
	updateMarker
} from '../packages/create-saas-starter/src/target.js';

vi.setConfig({ testTimeout: process.platform === 'win32' ? 60_000 : 20_000 });

const REPOSITORY_ROOT = path.resolve(import.meta.dirname, '..');

const temporaryDirectories: string[] = [];
afterEach(async () => {
	await Promise.all(
		temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true }))
	);
});

async function expectRootPrettierFormatted(bytes: string): Promise<void> {
	const file = path.join(REPOSITORY_ROOT, SCAFFOLD_MARKER);
	const config = await resolveConfig(file, { config: path.join(REPOSITORY_ROOT, '.prettierrc') });
	expect(config).not.toBeNull();
	const info = await getFileInfo(file, {
		ignorePath: path.join(REPOSITORY_ROOT, '.prettierignore')
	});
	expect(info.ignored).toBe(false);
	expect(await check(bytes, { ...config, filepath: file })).toBe(true);
}

describe('the scaffold marker', () => {
	it("is written in the generated project's Prettier format", async () => {
		const parent = await mkdtemp(path.join(tmpdir(), 'create-saas-starter-marker-format-'));
		temporaryDirectories.push(parent);
		const signal = new AbortController().signal;
		const claimed = await inspectTarget('claimed', parent);
		const current = initialMarker({
			ref: 'main',
			sha: 'a'.repeat(40),
			archiveSha256: 'b'.repeat(64)
		});
		await claimTarget(claimed, current, signal);
		const claimedMarker = path.join(claimed.path, SCAFFOLD_MARKER);
		await expectRootPrettierFormatted(await readFile(claimedMarker, 'utf8'));
		await updateMarker(claimed.path, current, 'ready', 'complete');
		await expectRootPrettierFormatted(await readFile(claimedMarker, 'utf8'));

		const staged = await inspectTarget('staged', parent);
		const staging = await createStagingTarget(staged, current, signal, { root: parent });
		await expectRootPrettierFormatted(await readFile(path.join(staging, SCAFFOLD_MARKER), 'utf8'));
	});
});
