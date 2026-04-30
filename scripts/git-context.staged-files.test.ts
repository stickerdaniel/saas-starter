import { spawnSync } from 'child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// Resolved from the project root (where vitest runs). Avoids `import.meta.url`,
// which vitest may rewrite to a non-file scheme during transform.
const HELPER = resolve(process.cwd(), 'scripts/git-context.ts');

/**
 * Spawn a subprocess that imports the real `getStagedFiles` helper and
 * prints its result as JSON. Importing the same exported function
 * `static-checks.ts` consumes ensures the test catches regressions in
 * the helper without re-implementing the git command.
 */
function runGetStagedFiles(cwd: string, extraEnv: Record<string, string> = {}): string[] {
	const code = `import(${JSON.stringify(HELPER)}).then((m) => { process.stdout.write(JSON.stringify(m.getStagedFiles())); });`;
	const result = spawnSync('bun', ['-e', code], {
		cwd,
		env: { ...process.env, ...extraEnv },
		encoding: 'utf-8'
	});
	if (result.status !== 0) {
		throw new Error(`harness failed (status ${result.status}): ${result.stderr}`);
	}
	return JSON.parse(result.stdout || '[]') as string[];
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

	it('filters siblings + relativizes when GIT_DIR is set externally (pre-commit framework simulation)', () => {
		// Issue #332 repro: a parent process (pre-commit framework) sets GIT_DIR
		// to the parent repo's gitdir and clears GIT_WORK_TREE before invoking
		// the hook. Without `--relative` + sanitizedGitEnv, the helper would
		// return both `web/src/a.ts` and `other/b.ts`, leaking the sibling and
		// breaking downstream tools that run from `cwd=web/`.
		const files = runGetStagedFiles(join(tmp, 'web'), {
			GIT_DIR: join(tmp, '.git'),
			GIT_WORK_TREE: ''
		});
		expect(files).toEqual(['src/a.ts']);
	});
});
