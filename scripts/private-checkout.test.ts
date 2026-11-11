import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import {
	chmodSync,
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	readlinkSync,
	realpathSync,
	rmSync,
	statSync,
	symlinkSync,
	writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
	createPrivateCheckout,
	removePrivateCheckout,
	type PrivateCheckout
} from './__fixtures__/static-checks/private-checkout';
import { sanitizedGitEnv } from './git-context';

const TEMP_ROOT = realpathSync.native(tmpdir());
const POSIX = process.platform !== 'win32';

function git(cwd: string, args: string[]): string {
	const result = spawnSync(
		'git',
		['-c', 'user.name=Probe', '-c', 'user.email=probe@example.com', ...args],
		{
			cwd,
			env: sanitizedGitEnv(),
			encoding: 'utf8'
		}
	);
	if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
	return result.stdout;
}

function commitAll(repository: string, message: string): void {
	git(repository, ['add', '-A']);
	git(repository, ['commit', '--quiet', '--no-verify', '--no-gpg-sign', '-m', message]);
}

function write(repository: string, relative: string, contents: string): void {
	mkdirSync(path.dirname(path.join(repository, relative)), { recursive: true });
	writeFileSync(path.join(repository, relative), contents);
}

/** `git ls-tree -r HEAD` as path to mode. */
function committedModes(repository: string): Map<string, string> {
	const modes = new Map<string, string>();
	for (const line of git(repository, ['ls-tree', '-r', '-z', 'HEAD']).split('\0')) {
		if (!line) continue;
		const [meta, file] = line.split('\t');
		modes.set(file!, meta!.split(' ')[0]!);
	}
	return modes;
}

function exists(file: string): boolean {
	try {
		lstatSync(file);
		return true;
	} catch {
		return false;
	}
}

/**
 * A committed source repository with installed-looking dependencies, then a mix of staged and
 * unstaged changes: an addition, a force-added ignored file, a deletion, a rename, a link
 * retarget, an executable bit, a directory replaced by a file staged and unstaged, an edited
 * file, and an untracked file. The directory name holds a literal percent escape, which a
 * file URL has to encode.
 */
function createSource(directory: string): string {
	const source = path.join(directory, 'source%41');
	mkdirSync(source);
	git(source, ['init', '--quiet', '--initial-branch=main']);
	write(source, '.gitignore', 'node_modules\nforced.txt\n');
	write(source, 'kept.txt', 'committed\n');
	write(source, 'removed.txt', 'removed\n');
	write(source, 'unstaged-keep.txt', 'deleted from the index only\n');
	write(source, 'old-name.txt', 'renamed\n');
	write(source, 'other.txt', 'other\n');
	write(source, 'tool.sh', '#!/bin/sh\n');
	write(source, 'folder/inner.txt', 'inner\n');
	write(source, 'blocked/inner.txt', 'blocked\n');
	if (POSIX) symlinkSync('kept.txt', path.join(source, 'link'));
	write(source, 'node_modules/fake-package/index.js', 'export default 1;\n');
	write(source, 'node_modules/.bin/fake', '#!/bin/sh\n');
	write(source, 'node_modules/$app/marker', 'source app\n');
	write(source, 'node_modules/.vite/marker', 'source cache\n');
	commitAll(source, 'Initial');

	write(source, 'added.txt', 'added\n');
	git(source, ['add', '--', 'added.txt']);
	write(source, 'forced.txt', 'forced\n');
	git(source, ['add', '--force', '--', 'forced.txt']);
	git(source, ['rm', '--quiet', '--', 'removed.txt']);
	git(source, ['mv', 'old-name.txt', 'new-name.txt']);
	git(source, ['rm', '--quiet', '-r', '--', 'folder']);
	write(source, 'folder', 'now a file\n');
	git(source, ['add', '--', 'folder']);
	if (POSIX) {
		rmSync(path.join(source, 'link'));
		symlinkSync('other.txt', path.join(source, 'link'));
		chmodSync(path.join(source, 'tool.sh'), 0o755);
		git(source, ['add', '--', 'link', 'tool.sh']);
	}
	write(source, 'kept.txt', 'edited on disk\n');
	write(source, 'untracked.txt', 'untracked\n');
	// Index membership wins over the disk: the file stays on disk but is no longer tracked.
	git(source, ['rm', '--quiet', '--cached', '--', 'unstaged-keep.txt']);
	// Working-tree bytes win over the index: staged once, then edited again.
	write(source, 'restaged.txt', 'staged\n');
	git(source, ['add', '--', 'restaged.txt']);
	write(source, 'restaged.txt', 'edited after staging\n');
	// Unstaged: the index still lists blocked/inner.txt, which no longer exists on disk.
	rmSync(path.join(source, 'blocked'), { recursive: true });
	write(source, 'blocked', 'untracked file\n');
	return source;
}

describe('private checkout', () => {
	let directory: string;
	let source: string;
	const allocated: PrivateCheckout[] = [];
	const allocate = (prefix: string): PrivateCheckout => {
		const checkout = createPrivateCheckout(prefix, source);
		allocated.push(checkout);
		return checkout;
	};

	beforeAll(() => {
		directory = mkdtempSync(path.join(TEMP_ROOT, 'private-checkout-test-'));
		source = createSource(directory);
	});

	afterAll(() => {
		for (const checkout of allocated) removePrivateCheckout(checkout);
		rmSync(directory, { recursive: true, force: true });
	});

	it('commits the source index with working-tree bytes and leaves untracked files out', () => {
		const { repository } = allocate('private-checkout-mirror-');
		const read = (file: string) => readFileSync(path.join(repository, file), 'utf8');

		expect(read('added.txt')).toBe('added\n');
		expect(read('forced.txt')).toBe('forced\n');
		expect(read('new-name.txt')).toBe('renamed\n');
		expect(read('folder')).toBe('now a file\n');
		expect(read('kept.txt')).toBe('edited on disk\n');
		expect(read('restaged.txt')).toBe('edited after staging\n');
		for (const gone of [
			'removed.txt',
			'old-name.txt',
			'untracked.txt',
			'blocked/inner.txt',
			'unstaged-keep.txt'
		]) {
			expect(exists(path.join(repository, gone)), gone).toBe(false);
		}
		expect(
			exists(path.join(repository, 'blocked')) &&
				statSync(path.join(repository, 'blocked')).isFile()
		).toBe(false);

		const committed = committedModes(repository);
		expect([...committed.keys()].sort()).toEqual(
			[
				'.gitignore',
				'added.txt',
				'folder',
				'forced.txt',
				'kept.txt',
				'new-name.txt',
				'other.txt',
				'restaged.txt',
				'tool.sh',
				...(POSIX ? ['link'] : [])
			].sort()
		);
		expect(git(repository, ['status', '--porcelain', '--untracked-files=no'])).toBe('');

		if (POSIX) {
			expect(readlinkSync(path.join(repository, 'link'))).toBe('other.txt');
			expect(statSync(path.join(repository, 'tool.sh')).mode & 0o111).not.toBe(0);
			expect(committed.get('link')).toBe('120000');
			expect(committed.get('tool.sh')).toBe('100755');
		}
	});

	it('mirrors the named source while the caller exports another repository', () => {
		const third = path.join(directory, 'third');
		mkdirSync(third);
		git(third, ['init', '--quiet', '--initial-branch=main']);
		write(third, 'third.txt', 'third\n');
		commitAll(third, 'Third');
		const index = path.join(third, '.git', 'index');
		const before = readFileSync(index);

		const saved = { GIT_DIR: process.env.GIT_DIR, GIT_INDEX_FILE: process.env.GIT_INDEX_FILE };
		process.env.GIT_DIR = path.join(third, '.git');
		process.env.GIT_INDEX_FILE = index;
		let checkout: PrivateCheckout;
		try {
			checkout = allocate('private-checkout-env-');
		} finally {
			for (const [key, value] of Object.entries(saved)) {
				if (value === undefined) delete process.env[key];
				else process.env[key] = value;
			}
		}

		const committed = [...committedModes(checkout.repository).keys()];
		expect(committed).toContain('added.txt');
		expect(committed).not.toContain('third.txt');
		expect(readFileSync(index).equals(before)).toBe(true);
	});

	it('links installed packages but keeps generated dependency output private', () => {
		const { repository } = allocate('private-checkout-modules-');
		const modules = path.join(repository, 'node_modules');
		const sourceModules = path.join(source, 'node_modules');

		expect(lstatSync(modules).isDirectory()).toBe(true);
		expect(realpathSync(path.join(modules, 'fake-package'))).toBe(
			realpathSync(path.join(sourceModules, 'fake-package'))
		);
		expect(realpathSync(path.join(modules, '.bin'))).toBe(
			realpathSync(path.join(sourceModules, '.bin'))
		);
		expect(exists(path.join(modules, '$app'))).toBe(false);
		expect(exists(path.join(modules, '.vite'))).toBe(false);

		// What SvelteKit sync does in a private run.
		mkdirSync(path.join(modules, '$app', 'types'), { recursive: true });
		writeFileSync(path.join(modules, '$app', 'tsconfig.json'), '{}\n');
		expect(readdirSync(path.join(sourceModules, '$app'))).toEqual(['marker']);
		expect(readFileSync(path.join(sourceModules, '$app', 'marker'), 'utf8')).toBe('source app\n');
	});

	it.skipIf(!POSIX)('refuses to read a tracked path through a linked source ancestor', () => {
		const linked = path.join(directory, 'linked-source');
		const outside = path.join(directory, 'outside');
		mkdirSync(linked);
		git(linked, ['init', '--quiet', '--initial-branch=main']);
		write(linked, 'nested/file.txt', 'tracked\n');
		commitAll(linked, 'Initial');
		write(outside, 'file.txt', 'external bytes\n');
		rmSync(path.join(linked, 'nested'), { recursive: true });
		symlinkSync(outside, path.join(linked, 'nested'), 'dir');
		const prefix = `private-checkout-linked-${randomBytes(6).toString('hex')}-`;

		expect(() => createPrivateCheckout(prefix, linked)).toThrow(/linked source ancestor/);
		expect(readdirSync(TEMP_ROOT).filter((name) => name.startsWith(prefix))).toEqual([]);
	});

	it('removes its directory when setup fails', () => {
		const notARepository = path.join(directory, 'not-a-repository');
		mkdirSync(notARepository);
		const prefix = `private-checkout-failure-${randomBytes(6).toString('hex')}-`;

		expect(() => createPrivateCheckout(prefix, notARepository)).toThrow(/git clone/);
		expect(readdirSync(TEMP_ROOT).filter((name) => name.startsWith(prefix))).toEqual([]);
	});
});
