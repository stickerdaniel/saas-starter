import { spawnSync } from 'child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const HELPER = resolve(process.cwd(), 'scripts/git-context.ts');

function runHelper<T>(cwd: string, expression: string, extraEnv: Record<string, string> = {}): T {
	const code = `import(${JSON.stringify(HELPER)}).then((m) => process.stdout.write(JSON.stringify(${expression})));`;
	const result = spawnSync('bun', ['-e', code], {
		cwd,
		env: { ...process.env, ...extraEnv },
		encoding: 'utf-8'
	});
	if (result.status !== 0) throw new Error(result.stderr);
	return JSON.parse(result.stdout || '[]') as T;
}

function git(cwd: string, args: string[], env: NodeJS.ProcessEnv = process.env): string {
	const result = spawnSync('git', args, { cwd, env, encoding: 'utf-8' });
	if (result.status !== 0) throw new Error(result.stderr);
	return result.stdout;
}

function installAssertOnlyHook(repository: string, log: string): void {
	const hook = join(repository, '.git', 'hooks', 'pre-commit');
	writeFileSync(
		hook,
		`#!/usr/bin/env bun
import { appendFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import {
	activeGitIndexFingerprint,
	getStagedFiles,
	stagedFilesMatchWorktree,
	stagedGitEnv
} from ${JSON.stringify(HELPER)};

const cwd = process.cwd();
const before = activeGitIndexFingerprint(cwd);
if (process.env.TEST_EARLY_STAGE) {
	const result = spawnSync('git', ['add', '--', process.env.TEST_EARLY_STAGE], {
		cwd,
		env: stagedGitEnv(cwd),
		encoding: 'utf-8'
	});
	if (result.status !== 0) process.exit(result.status ?? 1);
}
const files = getStagedFiles(cwd);
const matchesBefore = stagedFilesMatchWorktree(files, cwd);
appendFileSync(
	${JSON.stringify(log)},
	JSON.stringify({ index: process.env.GIT_INDEX_FILE, files, matchesBefore }) + '\\n'
);
if (!matchesBefore) process.exit(1);
if (process.env.TEST_LATE_WORKTREE && files[0]) {
	writeFileSync(files[0], process.env.TEST_LATE_WORKTREE);
}
if (process.env.TEST_LATE_STAGE) {
	const result = spawnSync('git', ['add', '--', process.env.TEST_LATE_STAGE], {
		cwd,
		env: stagedGitEnv(cwd),
		encoding: 'utf-8'
	});
	if (result.status !== 0) process.exit(result.status ?? 1);
}
if (activeGitIndexFingerprint(cwd) !== before) process.exit(1);
if (!stagedFilesMatchWorktree(files, cwd)) process.exit(1);
`
	);
	chmodSync(hook, 0o755);
}

describe('staged Git lifecycle', () => {
	let repository = '';

	beforeEach(() => {
		repository = mkdtempSync(join(tmpdir(), 'git-context-test-'));
		git(repository, ['init', '-q', '-b', 'main']);
		git(repository, ['config', 'user.email', 'test@example.com']);
		git(repository, ['config', 'user.name', 'Test']);
		git(repository, ['config', 'commit.gpgsign', 'false']);
		mkdirSync(join(repository, 'web', 'src'), { recursive: true });
		mkdirSync(join(repository, 'other'), { recursive: true });
		writeFileSync(join(repository, 'web', 'src', 'a.ts'), 'export const a = 1;\n');
		writeFileSync(join(repository, 'other', 'b.ts'), 'export const b = 2;\n');
		git(repository, ['add', 'web/src/a.ts', 'other/b.ts']);
	});

	afterEach(() => {
		rmSync(repository, { recursive: true, force: true });
	});

	it('filters siblings and anchors a relative index after cd', () => {
		expect(
			runHelper<string[]>(join(repository, 'web'), 'm.getStagedFiles()', {
				GIT_INDEX_FILE: '.git/index'
			})
		).toEqual(['src/a.ts']);
	});

	it.each([
		['commit -a', ['-a'], /^index\.lock$/, ['other/b.ts', 'web/src/a.ts']],
		['path-limited commit', ['--', 'web/src/a.ts'], /^next-index-\d+\.lock$/, ['web/src/a.ts']]
	] as const)(
		'reads the active index during %s without changing it',
		(_label, args, indexName, expectedFiles) => {
			git(repository, ['commit', '-qm', 'Initial']);
			writeFileSync(join(repository, 'web', 'src', 'a.ts'), 'export const a = 10;\n');
			writeFileSync(join(repository, 'other', 'b.ts'), 'export const b = 20;\n');
			const log = join(repository, '.git', 'hook.jsonl');
			installAssertOnlyHook(repository, log);

			const result = spawnSync('git', ['commit', '-qm', 'Update', ...args], {
				cwd: repository,
				encoding: 'utf-8'
			});

			expect(result.status, `${result.stdout}${result.stderr}`).toBe(0);
			const observed = JSON.parse(readFileSync(log, 'utf8').trim()) as {
				index?: string;
				files: string[];
				matchesBefore: boolean;
			};
			expect(observed.index?.split(/[\\/]/).at(-1)).toMatch(indexName);
			expect(observed.files).toEqual(expectedFiles);
			expect(observed.matchesBefore).toBe(true);
		}
	);

	it('aborts a patch commit whose rejected hunks remain in the worktree', () => {
		const file = join(repository, 'web', 'src', 'a.ts');
		const initial = Array.from({ length: 20 }, (_, index) => `export const line${index} = 0;`);
		writeFileSync(file, `${initial.join('\n')}\n`);
		git(repository, ['add', 'web/src/a.ts']);
		git(repository, ['commit', '-qm', 'Initial']);
		const changed = [...initial];
		changed[0] = 'export const line0 = 1;';
		changed[19] = 'export const line19 = 1;';
		writeFileSync(file, `${changed.join('\n')}\n`);
		installAssertOnlyHook(repository, join(repository, '.git', 'hook.jsonl'));

		const result = spawnSync('git', ['commit', '-p', '-m', 'Patch'], {
			cwd: repository,
			input: 'y\nn\n',
			encoding: 'utf-8',
			env: { ...process.env, GIT_PAGER: 'cat' }
		});

		expect(result.status).toBe(1);
		expect(git(repository, ['show', 'HEAD:web/src/a.ts'])).toBe(`${initial.join('\n')}\n`);
	});

	it('aborts when staged bytes differ from the checked worktree', () => {
		git(repository, ['commit', '-qm', 'Initial']);
		const file = join(repository, 'web', 'src', 'a.ts');
		writeFileSync(file, 'export const secret = "staged";\n');
		git(repository, ['add', 'web/src/a.ts']);
		writeFileSync(file, 'export const a = 2;\n');
		installAssertOnlyHook(repository, join(repository, '.git', 'hook.jsonl'));

		const result = spawnSync('git', ['commit', '-qm', 'Unsafe'], {
			cwd: repository,
			encoding: 'utf-8'
		});

		expect(result.status).toBe(1);
		expect(git(repository, ['show', ':web/src/a.ts'])).toContain('secret');
		expect(readFileSync(file, 'utf8')).toBe('export const a = 2;\n');
	});

	it('aborts when the index changes before staged file selection', () => {
		git(repository, ['commit', '-qm', 'Initial']);
		writeFileSync(join(repository, 'web', 'src', 'a.ts'), 'export const a = 10;\n');
		git(repository, ['add', 'web/src/a.ts']);
		writeFileSync(join(repository, 'other', 'b.ts'), 'export const b = 20;\n');
		installAssertOnlyHook(repository, join(repository, '.git', 'hook.jsonl'));

		const result = spawnSync('git', ['commit', '-qm', 'Unsafe'], {
			cwd: repository,
			encoding: 'utf-8',
			env: { ...process.env, TEST_EARLY_STAGE: 'other/b.ts' }
		});

		expect(result.status).toBe(1);
		expect(git(repository, ['show', 'HEAD:other/b.ts'])).toBe('export const b = 2;\n');
	});

	it('aborts when the index changes after file selection', () => {
		git(repository, ['commit', '-qm', 'Initial']);
		writeFileSync(join(repository, 'web', 'src', 'a.ts'), 'export const a = 10;\n');
		git(repository, ['add', 'web/src/a.ts']);
		writeFileSync(join(repository, 'other', 'b.ts'), 'export const b = 20;\n');
		installAssertOnlyHook(repository, join(repository, '.git', 'hook.jsonl'));

		const result = spawnSync('git', ['commit', '-qm', 'Unsafe'], {
			cwd: repository,
			encoding: 'utf-8',
			env: { ...process.env, TEST_LATE_STAGE: 'other/b.ts' }
		});

		expect(result.status).toBe(1);
		expect(git(repository, ['show', 'HEAD:other/b.ts'])).toBe('export const b = 2;\n');
	});

	it('aborts when checked worktree bytes change before completion', () => {
		git(repository, ['commit', '-qm', 'Initial']);
		writeFileSync(join(repository, 'web', 'src', 'a.ts'), 'export const a = 10;\n');
		git(repository, ['add', 'web/src/a.ts']);
		installAssertOnlyHook(repository, join(repository, '.git', 'hook.jsonl'));

		const result = spawnSync('git', ['commit', '-qm', 'Unsafe'], {
			cwd: repository,
			encoding: 'utf-8',
			env: { ...process.env, TEST_LATE_WORKTREE: 'export const a = 99;\n' }
		});

		expect(result.status).toBe(1);
		expect(git(repository, ['show', 'HEAD:web/src/a.ts'])).toBe('export const a = 1;\n');
	});

	it.each(['relative', 'external'] as const)('commits through a %s alternative index', (kind) => {
		git(repository, ['commit', '-qm', 'Initial']);
		const index = kind === 'relative' ? '.git/release-index' : join(repository, 'release-index');
		const env = {
			...process.env,
			GIT_INDEX_FILE: index,
			...(kind === 'external' ? { STATIC_CHECKS_ALLOW_EXTERNAL_GIT_INDEX: '1' } : {})
		};
		git(repository, ['read-tree', 'HEAD'], env);
		writeFileSync(join(repository, 'web', 'src', 'a.ts'), 'export const a = 10;\n');
		git(repository, ['add', 'web/src/a.ts'], env);
		const log = join(repository, '.git', 'hook.jsonl');
		installAssertOnlyHook(repository, log);

		const result = spawnSync('git', ['commit', '-qm', 'Alternative'], {
			cwd: repository,
			env,
			encoding: 'utf-8'
		});

		expect(result.status, `${result.stdout}${result.stderr}`).toBe(0);
		expect(git(repository, ['show', 'HEAD:web/src/a.ts'])).toBe('export const a = 10;\n');
	});
});
