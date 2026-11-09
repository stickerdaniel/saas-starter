// @vitest-environment node
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { BRANCH_HEAD_COMMAND } from './branch-head';

const projectRoot = fileURLToPath(new URL('../..', import.meta.url));
let origin: string;

beforeEach(() => {
	origin = mkdtempSync(path.join(tmpdir(), 'branch-head-'));
});
afterEach(() => rmSync(origin, { recursive: true, force: true }));

function git(...args: string[]): string {
	return execFileSync(
		'git',
		['-c', 'user.name=Test', '-c', 'user.email=test@example.com', ...args],
		{ cwd: origin, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: origin } }
	).trim();
}

/** Run the command as `convex deploy --cmd` does: a shell in the project root. */
function check(commit: string): number | null {
	return spawnSync('sh', ['-c', BRANCH_HEAD_COMMAND], {
		cwd: projectRoot,
		env: {
			PATH: process.env.PATH,
			HOME: origin,
			// `origin` of this repository is the temporary repository itself.
			GIT_DIR: path.join(origin, '.git'),
			WORKERS_CI: '1',
			WORKERS_CI_BRANCH: 'feature/x',
			WORKERS_CI_COMMIT_SHA: commit
		}
	}).status;
}

it('passes only while the build commit is the branch head on origin', () => {
	git('init', '-q', '-b', 'feature/x');
	git('commit', '-q', '--allow-empty', '-m', 'one');
	git('remote', 'add', 'origin', origin);
	const commit = git('rev-parse', 'HEAD');
	expect(check(commit)).toBe(0);

	git('commit', '-q', '--allow-empty', '-m', 'two');
	expect(check(commit)).toBe(1);
});
