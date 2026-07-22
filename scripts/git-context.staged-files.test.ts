import { spawnSync } from 'child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const HELPER = resolve(process.cwd(), 'scripts/git-context.ts');

function runHelper<T>(cwd: string, expression: string, extraEnv: Record<string, string> = {}): T {
	const code = `import(${JSON.stringify(HELPER)}).then((m) => { process.stdout.write(JSON.stringify(${expression})); });`;
	const result = spawnSync('bun', ['-e', code], {
		cwd,
		env: { ...process.env, ...extraEnv },
		encoding: 'utf-8'
	});
	if (result.status !== 0) {
		throw new Error(`harness failed (status ${result.status}): ${result.stderr}`);
	}
	return JSON.parse(result.stdout || '[]') as T;
}

function runGetStagedFiles(cwd: string, extraEnv: Record<string, string> = {}): string[] {
	return runHelper<string[]>(cwd, 'm.getStagedFiles()', extraEnv);
}

function gitInTmp(tmp: string, args: string[]): void {
	const result = spawnSync('git', args, { cwd: tmp, encoding: 'utf-8' });
	if (result.status !== 0) {
		throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
	}
}

describe('getStagedFiles (integration)', () => {
	let tmp: string;

	beforeEach(() => {
		tmp = mkdtempSync(join(tmpdir(), 'git-context-test-'));

		gitInTmp(tmp, ['init', '-q', '-b', 'main']);
		gitInTmp(tmp, ['config', 'user.email', 'test@example.com']);
		gitInTmp(tmp, ['config', 'user.name', 'Test']);
		gitInTmp(tmp, ['config', 'commit.gpgsign', 'false']);

		mkdirSync(join(tmp, 'web', 'src'), { recursive: true });
		mkdirSync(join(tmp, 'other'), { recursive: true });
		writeFileSync(join(tmp, 'web', 'src', 'a.ts'), 'export const a = 1;\n');
		writeFileSync(join(tmp, 'other', 'b.ts'), 'export const b = 2;\n');

		gitInTmp(tmp, ['add', 'web/src/a.ts', 'other/b.ts']);
	});

	afterEach(() => {
		if (tmp) rmSync(tmp, { recursive: true, force: true });
	});

	it('returns paths under cwd only, with the cwd prefix stripped', () => {
		const files = runGetStagedFiles(join(tmp, 'web'));
		expect(files).toEqual(['src/a.ts']);
	});

	it('preserves delete and rename metadata while file output keeps live targets only', () => {
		gitInTmp(tmp, ['commit', '-qm', 'Initial']);
		writeFileSync(join(tmp, 'web', 'src', 'added.ts'), 'export const added = true;\n');
		gitInTmp(tmp, ['add', 'web/src/added.ts']);
		gitInTmp(tmp, ['rm', '-q', 'web/src/a.ts']);
		gitInTmp(tmp, ['mv', 'other/b.ts', 'other/c.ts']);

		expect(runHelper(join(tmp, 'web'), 'm.getStagedChanges()')).toEqual([
			{ status: 'D', path: 'src/a.ts' },
			{ status: 'A', path: 'src/added.ts' }
		]);
		expect(runGetStagedFiles(join(tmp, 'web'))).toEqual(['src/added.ts']);
	});

	it('filters siblings + relativizes when GIT_DIR is set externally', () => {
		const files = runGetStagedFiles(join(tmp, 'web'), {
			GIT_DIR: join(tmp, '.git'),
			GIT_WORK_TREE: ''
		});
		expect(files).toEqual(['src/a.ts']);
	});
});
