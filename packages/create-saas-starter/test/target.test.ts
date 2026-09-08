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

	it('claims the target exclusively and keeps a concurrently claimed target', async () => {
		const parent = await temporaryParent('create-saas-starter-race-');
		const first = await inspectTarget('project', parent);
		const second = await inspectTarget('project', parent);
		await claimTarget(first, marker());
		await writeFile(path.join(first.path, 'sentinel'), 'preserve');

		await expect(claimTarget(second, marker())).rejects.toMatchObject({ code: 'EEXIST' });
		expect(await readFile(path.join(first.path, 'sentinel'), 'utf8')).toBe('preserve');
	});

	it('writes files exclusively and advances marker states', async () => {
		const parent = await temporaryParent('create-saas-starter-marker-');
		const plan = await inspectTarget('project', parent);
		let current = marker();
		await claimTarget(plan, current);
		const archive: ValidatedArchive = {
			sha256: 'b'.repeat(64),
			files: [
				{ path: 'nested', type: 'directory', mode: 0o755 },
				{ path: 'nested/file.txt', type: 'file', data: Buffer.from('content'), mode: 0o644 }
			]
		};
		await writeArchive(plan.path, archive);
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

	it('preserves files created before a later write failure', async () => {
		const parent = await temporaryParent('create-saas-starter-preserve-');
		const plan = await inspectTarget('project', parent);
		await claimTarget(plan, marker());
		await writeFile(path.join(plan.path, 'foreign.txt'), 'foreign');
		const archive: ValidatedArchive = {
			sha256: 'b'.repeat(64),
			files: [{ path: 'foreign.txt', type: 'file', data: Buffer.from('creator'), mode: 0o644 }]
		};

		await expect(writeArchive(plan.path, archive)).rejects.toMatchObject({ code: 'EEXIST' });
		expect(await readFile(path.join(plan.path, 'foreign.txt'), 'utf8')).toBe('foreign');
	});
});
