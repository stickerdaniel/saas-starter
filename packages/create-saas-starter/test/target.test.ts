import {
	chmod,
	cp,
	lstat,
	mkdtemp,
	mkdir,
	readFile,
	readdir,
	realpath,
	rm,
	symlink,
	writeFile
} from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { archivePathForTarget, SCAFFOLD_MARKER, type ValidatedArchive } from '../src/archive.js';
import {
	claimTarget,
	createStagingTarget,
	initialMarker,
	inspectTarget,
	publishStagedTarget,
	updateMarker,
	validateArchiveTargetPaths,
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

async function markerAt(target: string): Promise<{ state: string; phase: string }> {
	return JSON.parse(await readFile(path.join(target, SCAFFOLD_MARKER), 'utf8')) as {
		state: string;
		phase: string;
	};
}

// Generated projects keep the marker at their root, where the template's own
// Prettier config and ignore file apply. Template setup deletes this package, so
// the check loads the root project's Prettier instead of depending on it here.
const REPOSITORY_ROOT = path.resolve(import.meta.dirname, '../../..');

interface RootPrettier {
	resolveConfig(file: string, options: { config: string }): Promise<Record<string, unknown> | null>;
	getFileInfo(file: string, options: { ignorePath: string }): Promise<{ ignored: boolean }>;
	check(source: string, options: Record<string, unknown>): Promise<boolean>;
}

async function expectRootPrettierFormatted(bytes: string): Promise<void> {
	const entry = createRequire(path.join(REPOSITORY_ROOT, 'package.json')).resolve('prettier');
	const prettier = (await import(pathToFileURL(entry).href)) as RootPrettier;
	const file = path.join(REPOSITORY_ROOT, SCAFFOLD_MARKER);
	const config = await prettier.resolveConfig(file, {
		config: path.join(REPOSITORY_ROOT, '.prettierrc')
	});
	expect(config).not.toBeNull();
	const info = await prettier.getFileInfo(file, {
		ignorePath: path.join(REPOSITORY_ROOT, '.prettierignore')
	});
	expect(info.ignored).toBe(false);
	expect(await prettier.check(bytes, { ...config, filepath: file })).toBe(true);
}

function activeSignal(): AbortSignal {
	return new AbortController().signal;
}

function archive(files: ValidatedArchive['files'] = []): ValidatedArchive {
	return { sha256: 'b'.repeat(64), files };
}

describe('target ownership', () => {
	it('accepts safe dot-dot prefixes and Svelte route names without weakening traversal checks', () => {
		const target = path.join(path.parse(path.resolve('.')).root, 'target');
		expect(archivePathForTarget(target, '..config')).toBe(path.join(target, '..config'));
		expect(archivePathForTarget(target, 'src/routes/[[lang]]/(marketing)/+page.svelte')).toBe(
			path.join(target, 'src/routes/[[lang]]/(marketing)/+page.svelte')
		);
		expect(() => archivePathForTarget(target, '../escape')).toThrow(/traversing|escape/);
		expect(() => archivePathForTarget(target, '/absolute')).toThrow(/absolute/);
	});

	it('checks marker and worst-case temporary marker paths portably', () => {
		const root = path.parse(path.resolve('.')).root;
		expect(() => validateArchiveTargetPaths(path.join(root, 'a'.repeat(235)), archive())).toThrow(
			/scaffold marker.*Windows UTF-16/
		);
		expect(() => validateArchiveTargetPaths(path.join(root, 'a'.repeat(180)), archive())).toThrow(
			/temporary scaffold marker.*Windows UTF-16/
		);
	});

	it('checks full archive paths in POSIX bytes and Windows UTF-16 units', () => {
		const target = path.join(path.parse(path.resolve('.')).root, 'target');
		expect(() =>
			validateArchiveTargetPaths(
				target,
				archive([{ path: 'a'.repeat(255), type: 'file', data: Buffer.alloc(0), mode: 0o644 }])
			)
		).toThrow(/archive file.*Windows UTF-16/);
		const utf8Path = Array.from({ length: 6 }, () => '界'.repeat(80)).join('/');
		expect(() =>
			validateArchiveTargetPaths(
				target,
				archive([{ path: utf8Path, type: 'file', data: Buffer.alloc(0), mode: 0o644 }])
			)
		).toThrow(/archive parent directory.*POSIX bytes/);
	});

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

	it.runIf(process.platform !== 'win32')(
		'rejects an unprotected staging root before materializing files',
		async () => {
			const parent = await temporaryParent('create-saas-starter-target-parent-');
			const stagingRoot = await temporaryParent('create-saas-starter-shared-staging-');
			await chmod(stagingRoot, 0o777);
			const plan = await inspectTarget('project', parent);

			await expect(
				createStagingTarget(plan, marker(), activeSignal(), { root: stagingRoot })
			).rejects.toThrow(/staging root is writable by other users without sticky protection/i);
			expect(await readdir(stagingRoot)).toEqual([]);
		}
	);

	it.runIf(process.platform !== 'win32')(
		'falls back to a protected target-parent root across POSIX devices',
		async () => {
			const parent = await temporaryParent('create-saas-starter-target-device-');
			const preferredRoot = await temporaryParent('create-saas-starter-other-device-');
			const plan = await inspectTarget('project', parent);
			const canonicalPreferredRoot = await realpath(preferredRoot);
			const device = vi.fn(async (value: string) => (value === canonicalPreferredRoot ? 1 : 2));

			const staging = await createStagingTarget(plan, marker(), activeSignal(), {
				root: preferredRoot,
				device
			});

			expect(path.dirname(staging)).toBe(plan.parent);
			expect(device).toHaveBeenCalledTimes(2);
		}
	);

	it('does not apply the POSIX device contract to Windows profile staging', async () => {
		const profile = await temporaryParent('create-saas-starter-windows-profile-');
		const stagingRoot = path.join(profile, 'staging');
		await mkdir(stagingRoot);
		const parent = await temporaryParent('create-saas-starter-windows-target-');
		const plan = await inspectTarget('project', parent);
		const device = vi.fn(async () => 1);

		const staging = await createStagingTarget(plan, marker(), activeSignal(), {
			platform: 'win32',
			environment: { USERPROFILE: profile },
			root: stagingRoot,
			device
		});

		expect(path.dirname(staging)).toBe(await realpath(stagingRoot));
		expect(device).not.toHaveBeenCalled();
	});

	it.runIf(process.platform !== 'win32')(
		'publishes a completed staging directory through an exclusive final claim',
		async () => {
			const parent = await temporaryParent('create-saas-starter-publish-parent-');
			const stagingRoot = await temporaryParent('create-saas-starter-sticky-staging-');
			await chmod(stagingRoot, 0o1777);
			const plan = await inspectTarget('project', parent);
			const staging = await createStagingTarget(plan, marker(), activeSignal(), {
				root: stagingRoot
			});
			await writeFile(path.join(staging, 'content.txt'), 'complete');

			await publishStagedTarget(plan, staging, activeSignal());

			expect(await readFile(path.join(plan.path, 'content.txt'), 'utf8')).toBe('complete');
			await expect(lstat(staging)).rejects.toMatchObject({ code: 'ENOENT' });
		}
	);

	it.runIf(process.platform === 'win32')(
		'publishes from the protected Windows user-profile staging directory',
		async () => {
			const parent = await temporaryParent('create-saas-starter-windows-publish-');
			const plan = await inspectTarget('project', parent);
			const staging = await createStagingTarget(plan, marker(), activeSignal());
			await writeFile(path.join(staging, 'content.txt'), 'complete');

			await publishStagedTarget(plan, staging, activeSignal());

			expect(await readFile(path.join(plan.path, 'content.txt'), 'utf8')).toBe('complete');
			await expect(lstat(staging)).rejects.toMatchObject({ code: 'ENOENT' });
		}
	);

	it('publishes the Windows ready marker only after every project entry', async () => {
		const parent = await temporaryParent('create-saas-starter-marker-order-');
		const plan = await inspectTarget('project', parent);
		const current = marker();
		const staging = await createStagingTarget(plan, current, activeSignal());
		await writeFile(path.join(staging, 'content.txt'), 'complete');
		await updateMarker(staging, current, 'ready', 'complete');
		const copy = (async (
			source: string,
			destination: string,
			options: Parameters<typeof cp>[2]
		) => {
			if (path.basename(source) === 'content.txt') throw new Error('copy failed');
			await cp(source, destination, options);
		}) as typeof cp;

		await expect(
			publishStagedTarget(plan, staging, activeSignal(), { platform: 'win32', copy })
		).rejects.toThrow('Recovery files remain');
		await expect(lstat(path.join(plan.path, SCAFFOLD_MARKER))).rejects.toMatchObject({
			code: 'ENOENT'
		});
		await expect(markerAt(staging)).resolves.toMatchObject({ state: 'ready', phase: 'complete' });
	});

	it('removes the Windows marker when interrupted at the commit boundary', async () => {
		const parent = await temporaryParent('create-saas-starter-marker-abort-');
		const plan = await inspectTarget('project', parent);
		const current = marker();
		const staging = await createStagingTarget(plan, current, activeSignal());
		await writeFile(path.join(staging, 'content.txt'), 'complete');
		await updateMarker(staging, current, 'ready', 'complete');
		const controller = new AbortController();
		const copy = (async (
			source: string,
			destination: string,
			options: Parameters<typeof cp>[2]
		) => {
			await cp(source, destination, options);
			if (path.basename(source) === SCAFFOLD_MARKER)
				controller.abort(new Error('interrupt commit'));
		}) as typeof cp;

		await expect(
			publishStagedTarget(plan, staging, controller.signal, { platform: 'win32', copy })
		).rejects.toThrow('Recovery files remain');
		await expect(lstat(path.join(plan.path, SCAFFOLD_MARKER))).rejects.toMatchObject({
			code: 'ENOENT'
		});
		await expect(markerAt(staging)).resolves.toMatchObject({ state: 'ready', phase: 'complete' });
	});

	it('does not turn a committed Windows target into failure when staging cleanup fails', async () => {
		const parent = await temporaryParent('create-saas-starter-cleanup-');
		const plan = await inspectTarget('project', parent);
		const current = marker();
		const staging = await createStagingTarget(plan, current, activeSignal());
		await writeFile(path.join(staging, 'content.txt'), 'complete');
		await updateMarker(staging, current, 'ready', 'complete');

		await expect(
			publishStagedTarget(plan, staging, activeSignal(), {
				platform: 'win32',
				cleanup: async () => {
					throw new Error('cleanup failed');
				}
			})
		).resolves.toEqual({ retainedStaging: staging });
		await expect(markerAt(plan.path)).resolves.toMatchObject({ state: 'ready', phase: 'complete' });
		expect(await readFile(path.join(plan.path, 'content.txt'), 'utf8')).toBe('complete');
		expect(await lstat(staging)).toBeDefined();
	});

	it('preserves staging when another process wins the final target claim', async () => {
		const parent = await temporaryParent('create-saas-starter-publish-race-');
		const plan = await inspectTarget('project', parent);
		const staging = await createStagingTarget(plan, marker(), activeSignal());
		await writeFile(path.join(staging, 'content.txt'), 'complete');
		await mkdir(plan.path);
		const claimed = await lstat(plan.path);

		await expect(publishStagedTarget(plan, staging, activeSignal())).rejects.toThrow(
			'Recovery files remain'
		);
		expect((await lstat(plan.path)).ino).toBe(claimed.ino);
		expect(await readdir(plan.path)).toEqual([]);
		expect(await readFile(path.join(staging, 'content.txt'), 'utf8')).toBe('complete');
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

	it("writes every marker in the generated project's Prettier format", async () => {
		const parent = await temporaryParent('create-saas-starter-marker-format-');
		const claimed = await inspectTarget('claimed', parent);
		const current = marker();
		await claimTarget(claimed, current, activeSignal());
		const claimedMarker = path.join(claimed.path, SCAFFOLD_MARKER);
		await expectRootPrettierFormatted(await readFile(claimedMarker, 'utf8'));
		await updateMarker(claimed.path, current, 'ready', 'complete');
		await expectRootPrettierFormatted(await readFile(claimedMarker, 'utf8'));

		const staged = await inspectTarget('staged', parent);
		const staging = await createStagingTarget(staged, current, activeSignal());
		temporaryDirectories.push(staging);
		await expectRootPrettierFormatted(await readFile(path.join(staging, SCAFFOLD_MARKER), 'utf8'));
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
