import { spawnSync } from 'node:child_process';
import {
	chmodSync,
	mkdirSync,
	mkdtempSync,
	realpathSync,
	rmSync,
	symlinkSync,
	writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	activeGitIndexFingerprint,
	getStagedFiles,
	isolatedGitEnv,
	sanitizedGitEnv,
	stagedFilesMatchWorktree,
	stagedFilesWithCleanFilters,
	stagedGitEnv
} from './git-context';

const SCRUBBED = [
	'GIT_ALTERNATE_OBJECT_DIRECTORIES',
	'GIT_ATTR_NOSYSTEM',
	'GIT_ATTR_SOURCE',
	'GIT_COMMON_DIR',
	'GIT_CONFIG',
	'GIT_DIR',
	'GIT_GRAFT_FILE',
	'GIT_IMPLICIT_WORK_TREE',
	'GIT_INDEX_FILE',
	'GIT_NO_REPLACE_OBJECTS',
	'GIT_OBJECT_DIRECTORY',
	'GIT_PREFIX',
	'GIT_REPLACE_REF_BASE',
	'GIT_SHALLOW_FILE',
	'GIT_TEMPLATE_DIR',
	'GIT_WORK_TREE'
] as const;
const SCRUBBED_CONFIG = [
	'GIT_CONFIG_PARAMETERS',
	'GIT_CONFIG_COUNT',
	'GIT_CONFIG_GLOBAL',
	'GIT_CONFIG_SYSTEM',
	'GIT_CONFIG_NOSYSTEM',
	'GIT_CONFIG_KEY_0',
	'GIT_CONFIG_VALUE_0'
] as const;
const EXTERNAL_INDEX_OPT_IN = 'STATIC_CHECKS_ALLOW_EXTERNAL_GIT_INDEX';

function isolatedValue(key: string): string | undefined {
	if (
		[
			'GIT_ATTR_NOSYSTEM',
			'GIT_NO_REPLACE_OBJECTS',
			'GIT_CONFIG_NOSYSTEM',
			'GIT_CONFIG_COUNT'
		].includes(key)
	) {
		return '1';
	}
	if (key === 'GIT_CONFIG_KEY_0') return 'core.attributesFile';
	if (
		['GIT_GRAFT_FILE', 'GIT_CONFIG_GLOBAL', 'GIT_CONFIG_SYSTEM', 'GIT_CONFIG_VALUE_0'].includes(key)
	) {
		return '';
	}
	return undefined;
}

function git(cwd: string, args: string[], env: NodeJS.ProcessEnv = sanitizedGitEnv()): string {
	const result = spawnSync('git', args, { cwd, env, encoding: 'utf-8' });
	if (result.status !== 0) throw new Error(result.stderr);
	return result.stdout;
}

describe('sanitizedGitEnv', () => {
	const saved = new Map<string, string | undefined>();

	beforeEach(() => {
		for (const key of [...SCRUBBED, ...SCRUBBED_CONFIG]) saved.set(key, process.env[key]);
	});

	afterEach(() => {
		for (const [key, value] of saved) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
		saved.clear();
	});

	it('removes Git repository, index, and object-store context', () => {
		for (const key of SCRUBBED) process.env[key] = 'parent-value';
		const env = sanitizedGitEnv();
		for (const key of SCRUBBED) expect(env[key]).toBeUndefined();
	});

	it('preserves command-scoped Git configuration', () => {
		process.env.GIT_CONFIG_PARAMETERS = "'safe.directory'='/checkout'";
		process.env.GIT_CONFIG_COUNT = '1';
		process.env.GIT_CONFIG_KEY_0 = 'core.autocrlf';
		process.env.GIT_CONFIG_VALUE_0 = 'false';
		const env = sanitizedGitEnv();
		expect(env.GIT_CONFIG_PARAMETERS).toBe(process.env.GIT_CONFIG_PARAMETERS);
		expect(env.GIT_CONFIG_COUNT).toBe('1');
		expect(env.GIT_CONFIG_KEY_0).toBe('core.autocrlf');
		expect(env.GIT_CONFIG_VALUE_0).toBe('false');
		delete process.env.GIT_CONFIG_PARAMETERS;
		delete process.env.GIT_CONFIG_COUNT;
		delete process.env.GIT_CONFIG_KEY_0;
		delete process.env.GIT_CONFIG_VALUE_0;
	});

	it('isolates command configuration and pins real ancestry', () => {
		for (const key of [...SCRUBBED, ...SCRUBBED_CONFIG]) process.env[key] = 'parent-value';
		const env = isolatedGitEnv();
		for (const key of [...SCRUBBED, ...SCRUBBED_CONFIG]) {
			expect(env[key], key).toBe(isolatedValue(key));
		}
	});

	it('disables external Git attribute sources for isolated children', () => {
		process.env.GIT_ATTR_SOURCE = 'HEAD';
		const env = isolatedGitEnv();
		const globalAttributes = spawnSync('git', ['var', 'GIT_ATTR_GLOBAL'], {
			env,
			encoding: 'utf8'
		});
		const systemAttributes = spawnSync('git', ['var', 'GIT_ATTR_SYSTEM'], {
			env,
			encoding: 'utf8'
		});

		expect(env.GIT_ATTR_SOURCE).toBeUndefined();
		expect(globalAttributes.status).toBe(0);
		expect(globalAttributes.stdout.trim()).toBe('');
		expect(systemAttributes.status).not.toBe(0);
	});

	it('removes Git context regardless of environment-name casing', () => {
		process.env.git_dir = '/parent/.git';
		process.env.git_index_file = '/parent/.git/index';
		const env = sanitizedGitEnv();
		expect(env.git_dir).toBeUndefined();
		expect(env.git_index_file).toBeUndefined();
		delete process.env.git_dir;
		delete process.env.git_index_file;
	});

	it('preserves unrelated variables without mutating process.env', () => {
		process.env.GIT_DIR = '/parent/.git';
		process.env.MY_UNRELATED_VAR = 'keep-me';
		const env = sanitizedGitEnv();
		expect(env.MY_UNRELATED_VAR).toBe('keep-me');
		expect(process.env.GIT_DIR).toBe('/parent/.git');
		delete process.env.MY_UNRELATED_VAR;
	});
});

describe('staged Git context', () => {
	const saved = new Map<string, string | undefined>();
	let directory = '';
	let repository = '';
	let gitDirectory = '';

	beforeEach(() => {
		for (const key of [...SCRUBBED, EXTERNAL_INDEX_OPT_IN]) saved.set(key, process.env[key]);
		for (const key of [...SCRUBBED, EXTERNAL_INDEX_OPT_IN]) delete process.env[key];
		directory = mkdtempSync(path.join(tmpdir(), 'git-context-'));
		repository = path.join(directory, 'repository');
		mkdirSync(repository);
		git(repository, ['init', '-q', '-b', 'main']);
		git(repository, ['config', 'user.email', 'test@example.com']);
		git(repository, ['config', 'user.name', 'Test']);
		git(repository, ['config', 'commit.gpgsign', 'false']);
		writeFileSync(path.join(repository, 'a.ts'), 'export const a = 1;\n');
		git(repository, ['add', 'a.ts']);
		gitDirectory = git(repository, ['rev-parse', '--absolute-git-dir']).trimEnd();
	});

	afterEach(() => {
		for (const [key, value] of saved) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
		saved.clear();
		rmSync(directory, { recursive: true, force: true });
	});

	it.each(['index.lock', 'next-index-123.lock'])(
		'preserves repository temporary index %s',
		(name) => {
			const candidate = path.join(gitDirectory, name);
			writeFileSync(candidate, 'index fixture');
			process.env.GIT_INDEX_FILE = candidate;
			process.env.GIT_DIR = path.join(directory, 'foreign.git');

			expect(stagedGitEnv(repository).GIT_INDEX_FILE).toBe(candidate);
		}
	);

	it('scrubs a Git-owned temporary index from a native parent hook', () => {
		const parent = path.join(directory, 'parent');
		const nested = path.join(parent, 'nested');
		mkdirSync(parent);
		git(parent, ['init', '-q', '-b', 'main']);
		mkdirSync(nested);
		git(nested, ['init', '-q', '-b', 'main']);
		const parentGitDirectory = git(parent, ['rev-parse', '--absolute-git-dir']).trimEnd();
		const parentIndex = path.join(parentGitDirectory, 'index.lock');
		writeFileSync(parentIndex, 'parent index');
		process.env.GIT_INDEX_FILE = parentIndex;

		expect(stagedGitEnv(nested).GIT_INDEX_FILE).toBeUndefined();
	});

	it('fails closed for an unowned external index.lock', () => {
		const external = path.join(directory, 'external');
		mkdirSync(external);
		const candidate = path.join(external, 'index.lock');
		writeFileSync(candidate, 'external index');
		process.env.GIT_INDEX_FILE = candidate;

		expect(() => stagedGitEnv(repository)).toThrow(
			'requires STATIC_CHECKS_ALLOW_EXTERNAL_GIT_INDEX'
		);
	});

	it('fails closed for an unowned arbitrary external index', () => {
		const candidate = path.join(directory, 'release-index');
		writeFileSync(candidate, 'external index');
		process.env.GIT_INDEX_FILE = candidate;

		expect(() => stagedGitEnv(repository)).toThrow(
			'requires STATIC_CHECKS_ALLOW_EXTERNAL_GIT_INDEX'
		);
	});

	it('preserves an explicitly allowed external index.lock', () => {
		const external = path.join(directory, 'external');
		mkdirSync(external);
		const candidate = path.join(external, 'index.lock');
		writeFileSync(candidate, 'external index');
		process.env.GIT_INDEX_FILE = candidate;
		process.env.STATIC_CHECKS_ALLOW_EXTERNAL_GIT_INDEX = '1';

		expect(stagedGitEnv(repository).GIT_INDEX_FILE).toBe(candidate);
	});

	it('anchors a relative index at the discovered Git root after cd', () => {
		const nested = path.join(repository, 'web');
		mkdirSync(nested);
		process.env.GIT_INDEX_FILE = '.git/index';

		expect(stagedGitEnv(nested).GIT_INDEX_FILE).toBe(path.join(gitDirectory, 'index'));
	});

	it('preserves explicitly allowed external indices and object stores', () => {
		const index = path.join(directory, 'release-index');
		const objects = path.join(directory, 'release-objects');
		const alternate = path.join(directory, 'alternate-objects');
		writeFileSync(index, 'index fixture');
		mkdirSync(objects);
		mkdirSync(alternate);
		process.env.GIT_INDEX_FILE = index;
		process.env.STATIC_CHECKS_ALLOW_EXTERNAL_GIT_INDEX = '1';
		process.env.GIT_OBJECT_DIRECTORY = objects;
		process.env.GIT_ALTERNATE_OBJECT_DIRECTORIES = alternate;

		const env = stagedGitEnv(repository);
		expect(env.GIT_INDEX_FILE).toBe(index);
		expect(env.GIT_OBJECT_DIRECTORY).toBe(realpathSync(objects));
		expect(env.GIT_ALTERNATE_OBJECT_DIRECTORIES).toBe(alternate);
	});

	it.skipIf(process.platform === 'win32')('accepts a symlinked object directory', () => {
		const target = path.join(directory, 'object-target');
		const link = path.join(directory, 'object-link');
		mkdirSync(target);
		symlinkSync(target, link, 'dir');
		process.env.GIT_OBJECT_DIRECTORY = link;

		expect(stagedGitEnv(repository).GIT_OBJECT_DIRECTORY).toBe(realpathSync(target));
	});

	it('preserves an explicit alternate store with the standard index', () => {
		const alternate = path.join(directory, 'alternate-objects');
		mkdirSync(alternate);
		process.env.GIT_ALTERNATE_OBJECT_DIRECTORIES = alternate;

		expect(stagedGitEnv(repository).GIT_ALTERNATE_OBJECT_DIRECTORIES).toBe(alternate);
	});

	it('preserves Git-quoted alternate object paths verbatim', () => {
		const alternate = path.join(directory, 'source:repo', 'objects');
		mkdirSync(alternate, { recursive: true });
		const quoted = JSON.stringify(alternate);
		process.env.GIT_ALTERNATE_OBJECT_DIRECTORIES = quoted;

		expect(stagedGitEnv(repository).GIT_ALTERNATE_OBJECT_DIRECTORIES).toBe(quoted);
	});

	it('scrubs an index and object stores inherited from a foreign repository', () => {
		const foreign = path.join(directory, 'foreign.git');
		const objects = path.join(foreign, 'objects');
		mkdirSync(objects, { recursive: true });
		const index = path.join(foreign, 'index');
		writeFileSync(index, 'index fixture');
		process.env.GIT_DIR = foreign;
		process.env.GIT_INDEX_FILE = index;
		process.env.GIT_OBJECT_DIRECTORY = objects;
		process.env.GIT_ALTERNATE_OBJECT_DIRECTORIES = objects;

		const env = stagedGitEnv(repository);
		expect(env.GIT_INDEX_FILE).toBeUndefined();
		expect(env.GIT_OBJECT_DIRECTORY).toBeUndefined();
		expect(env.GIT_ALTERNATE_OBJECT_DIRECTORIES).toBeUndefined();
	});

	it('preserves a Git directory ending with whitespace', () => {
		const worktree = path.join(directory, 'separate-worktree');
		const metadata = path.join(directory, 'metadata ');
		git(directory, ['init', '-q', '--separate-git-dir', metadata, worktree]);
		const candidate = path.join(metadata, 'index.lock');
		writeFileSync(candidate, 'index fixture');
		process.env.GIT_INDEX_FILE = candidate;

		expect(stagedGitEnv(worktree).GIT_INDEX_FILE).toBe(candidate);
	});

	it('fails closed for a missing or symlinked explicit index', () => {
		process.env.STATIC_CHECKS_ALLOW_EXTERNAL_GIT_INDEX = '1';
		process.env.GIT_INDEX_FILE = path.join(directory, 'missing-index');
		expect(() => stagedGitEnv(repository)).toThrow('not a regular file');

		if (process.platform !== 'win32') {
			const target = path.join(directory, 'target-index');
			const link = path.join(directory, 'linked-index');
			writeFileSync(target, 'index fixture');
			symlinkSync(target, link);
			process.env.GIT_INDEX_FILE = link;
			expect(() => stagedGitEnv(repository)).toThrow('not a regular file');
		}
	});

	it('fingerprints extended index state', () => {
		const before = activeGitIndexFingerprint(repository);
		git(repository, ['update-index', '--assume-unchanged', 'a.ts']);
		expect(activeGitIndexFingerprint(repository)).not.toBe(before);
	});

	it('enumerates staged paths without applying a replacement for HEAD', () => {
		writeFileSync(path.join(repository, 'safe.md'), '# Initial\n');
		git(repository, ['add', 'safe.md']);
		git(repository, ['commit', '-qm', 'Initial']);
		writeFileSync(path.join(repository, 'a.ts'), 'export const secret = "LIVE_SECRET_VALUE";\n');
		git(repository, ['add', 'a.ts']);
		const replacementTree = git(repository, ['write-tree']).trim();
		const replacementCommit = git(repository, [
			'commit-tree',
			replacementTree,
			'-p',
			'HEAD',
			'-m',
			'Replacement'
		]).trim();
		writeFileSync(path.join(repository, 'safe.md'), '# Changed\n');
		git(repository, ['add', 'safe.md']);
		git(repository, ['replace', 'HEAD', replacementCommit]);

		expect(getStagedFiles(repository).sort()).toEqual(['a.ts', 'safe.md']);
	});

	it('compares staged and worktree blobs through Git clean filters', () => {
		expect(stagedFilesMatchWorktree(['a.ts'], repository)).toBe(true);
		expect(stagedFilesWithCleanFilters(['a.ts'], repository)).toEqual([]);
		writeFileSync(path.join(repository, 'a.ts'), 'export const a = 2;\n');
		expect(stagedFilesMatchWorktree(['a.ts'], repository)).toBe(false);
	});

	it.skipIf(process.platform === 'win32')('accepts a clean-filtered staged blob', () => {
		const filter = path.join(directory, 'filter');
		writeFileSync(
			filter,
			'#!/usr/bin/env bun\nconst input = await Bun.stdin.text();\nprocess.stdout.write(input.replace("= 1", "= x"));\n'
		);
		chmodSync(filter, 0o755);
		git(repository, ['config', 'filter.corrupt.clean', filter]);
		git(repository, ['config', 'filter.corrupt.required', 'true']);
		writeFileSync(path.join(repository, '.gitattributes'), 'a.ts filter=corrupt\n');
		git(repository, ['add', '.gitattributes', 'a.ts']);

		expect(stagedFilesMatchWorktree(['a.ts'], repository)).toBe(true);
		expect(stagedFilesWithCleanFilters(['a.ts'], repository)).toEqual(['a.ts']);
	});

	it.skipIf(process.platform === 'win32')('rejects a staged path replaced by a FIFO', () => {
		const file = path.join(repository, 'a.ts');
		rmSync(file);
		const result = spawnSync('mkfifo', [file], { encoding: 'utf8' });
		if (result.status !== 0) throw new Error(result.stderr);

		expect(() => stagedFilesMatchWorktree(['a.ts'], repository)).toThrow(
			'Unsupported worktree path type'
		);
	});

	it('accepts a symlink placeholder when its raw blob matches', () => {
		const target = Buffer.from('target.ts');
		const objectId = spawnSync('git', ['hash-object', '-w', '--stdin'], {
			cwd: repository,
			env: sanitizedGitEnv(),
			input: target,
			encoding: 'utf-8'
		}).stdout.trim();
		git(repository, ['update-index', '--add', '--cacheinfo', `120000,${objectId},link.ts`]);
		writeFileSync(path.join(repository, 'link.ts'), target);

		expect(stagedFilesMatchWorktree(['link.ts'], repository)).toBe(true);
	});
});
