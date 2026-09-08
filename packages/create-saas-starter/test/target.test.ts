import { chmod, lstat, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SCAFFOLD_MARKER, type ValidatedArchive } from '../src/archive.js';
import {
	claimTarget,
	initialMarker,
	inspectTarget,
	updateMarker,
	writeArchive
} from '../src/target.js';

const temporaryDirectories: string[] = [];
afterEach(async () => {
	await Promise.all(
		temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true }))
	);
});

async function temporaryParent(prefix: string): Promise<string> {
	const directory = await mkdtemp(path.join(tmpdir(), prefix));
	temporaryDirectories.push(directory);
	return directory;
}

function marker() {
	return initialMarker({ ref: 'main', sha: 'a'.repeat(40), archiveSha256: 'b'.repeat(64) });
}

function activeSignal(): AbortSignal {
	return new AbortController().signal;
}

describe('target ownership', () => {
	it.each(['file', 'empty directory', 'dangling symlink'])(
		'rejects an existing %s without changing it',
		async (kind) => {
			const parent = await temporaryParent('create-saas-starter-target-');
			const target = path.join(parent, 'project');
			if (kind === 'file') await writeFile(target, 'preserve');
			else if (kind === 'empty directory') await mkdir(target);
			else await symlink(path.join(parent, 'missing'), target);
			const before = await lstat(target);

			await expect(inspectTarget('project', parent)).rejects.toThrow('already exists');
			const after = await lstat(target);
			expect(after.mode).toBe(before.mode);
			if (kind === 'file') expect(await readFile(target, 'utf8')).toBe('preserve');
		}
	);

	it('rejects the current directory, filesystem root, missing parents, and unsafe names', async () => {
		const parent = await temporaryParent('create-saas-starter-invalid-target-');
		await expect(inspectTarget('.', parent)).rejects.toThrow('current directory');
		await expect(inspectTarget(path.parse(parent).root, parent)).rejects.toThrow('filesystem root');
		await expect(inspectTarget('missing/project', parent)).rejects.toThrow('parent does not exist');
		await expect(inspectTarget('CON', parent)).rejects.toThrow('not portable');
		await expect(inspectTarget('COM¹.txt', parent)).rejects.toThrow('not portable');
		await expect(inspectTarget('LPT³', parent)).rejects.toThrow('not portable');
		if (process.platform !== 'win32') {
			await expect(inspectTarget(String.raw`bad\name`, parent)).rejects.toThrow('not portable');
		}
	});

	it.runIf(process.platform !== 'win32')('rejects an unwritable target parent', async () => {
		const parent = await temporaryParent('create-saas-starter-permission-');
		await chmod(parent, 0o555);
		try {
			await expect(inspectTarget('project', parent)).rejects.toMatchObject({ code: 'EACCES' });
		} finally {
			await chmod(parent, 0o755);
		}
	});

	it('does not claim a target after an earlier abort', async () => {
		const parent = await temporaryParent('create-saas-starter-pre-claim-abort-');
		const plan = await inspectTarget('project', parent);
		const controller = new AbortController();
		controller.abort(new Error('abort before claim'));

		await expect(claimTarget(plan, marker(), controller.signal)).rejects.toThrow(
			'abort before claim'
		);
		await expect(lstat(plan.path)).rejects.toMatchObject({ code: 'ENOENT' });
	});

	it('claims the target exclusively and keeps a concurrently claimed target', async () => {
		const parent = await temporaryParent('create-saas-starter-race-');
		const first = await inspectTarget('project', parent);
		const second = await inspectTarget('project', parent);
		await claimTarget(first, marker(), activeSignal());
		await writeFile(path.join(first.path, 'sentinel'), 'preserve');

		await expect(claimTarget(second, marker(), activeSignal())).rejects.toMatchObject({
			code: 'EEXIST'
		});
		expect(await readFile(path.join(first.path, 'sentinel'), 'utf8')).toBe('preserve');
	});

	it('writes files exclusively and advances marker states', async () => {
		const parent = await temporaryParent('create-saas-starter-marker-');
		const plan = await inspectTarget('project', parent);
		let current = marker();
		await claimTarget(plan, current, activeSignal());
		const archive: ValidatedArchive = {
			sha256: 'b'.repeat(64),
			files: [
				{ path: 'nested', type: 'directory', mode: 0o755 },
				{ path: 'nested/file.txt', type: 'file', data: Buffer.from('content'), mode: 0o644 }
			]
		};
		await writeArchive(plan.path, archive, activeSignal());
		expect(await readFile(path.join(plan.path, 'nested/file.txt'), 'utf8')).toBe('content');

		current = await updateMarker(plan.path, current, 'incomplete', 'install');
		expect(JSON.parse(await readFile(path.join(plan.path, SCAFFOLD_MARKER), 'utf8'))).toMatchObject(
			{
				state: 'incomplete',
				phase: 'install'
			}
		);
		await updateMarker(plan.path, current, 'ready', 'complete');
		expect(JSON.parse(await readFile(path.join(plan.path, SCAFFOLD_MARKER), 'utf8'))).toMatchObject(
			{
				state: 'ready',
				phase: 'complete'
			}
		);
	});

	it('stops deterministically at an abort boundary and preserves completed writes', async () => {
		const parent = await temporaryParent('create-saas-starter-write-abort-');
		const plan = await inspectTarget('project', parent);
		await claimTarget(plan, marker(), activeSignal());
		const archive: ValidatedArchive = {
			sha256: 'b'.repeat(64),
			files: [
				{ path: 'first.txt', type: 'file', data: Buffer.from('first'), mode: 0o644 },
				{ path: 'second.txt', type: 'file', data: Buffer.from('second'), mode: 0o644 }
			]
		};
		const controller = new AbortController();
		let checks = 0;
		const signal = {
			get aborted() {
				checks += 1;
				if (checks === 4) controller.abort(new Error('abort between files'));
				return controller.signal.aborted;
			},
			get reason() {
				return controller.signal.reason;
			}
		} as AbortSignal;

		await expect(writeArchive(plan.path, archive, signal)).rejects.toThrow('abort between files');
		expect(await readFile(path.join(plan.path, 'first.txt'), 'utf8')).toBe('first');
		await expect(readFile(path.join(plan.path, 'second.txt'))).rejects.toMatchObject({
			code: 'ENOENT'
		});
		expect(await lstat(plan.path)).toBeDefined();
	});

	it('preserves files created before a later write failure', async () => {
		const parent = await temporaryParent('create-saas-starter-preserve-');
		const plan = await inspectTarget('project', parent);
		await claimTarget(plan, marker(), activeSignal());
		await writeFile(path.join(plan.path, 'foreign.txt'), 'foreign');
		const archive: ValidatedArchive = {
			sha256: 'b'.repeat(64),
			files: [{ path: 'foreign.txt', type: 'file', data: Buffer.from('creator'), mode: 0o644 }]
		};

		await expect(writeArchive(plan.path, archive, activeSignal())).rejects.toMatchObject({
			code: 'EEXIST'
		});
		expect(await readFile(path.join(plan.path, 'foreign.txt'), 'utf8')).toBe('foreign');
	});
});
