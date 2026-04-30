/**
 * Git context helpers for scripts that run inside `git` hooks.
 *
 * Hooks may be dispatched by tools (notably the Python `pre-commit` framework)
 * that pre-set GIT_DIR / GIT_WORK_TREE in the hook's environment to point at
 * a parent repository. When the saas-starter app is nested in a subdirectory
 * of such a repo, those env vars cause `git diff --cached` and `git add` to
 * operate against the wrong worktree, silently corrupting commits (issue #332).
 *
 * These helpers scrub the relevant env vars before shelling out and prefer
 * `git diff --relative` so paths come back filtered + cwd-relative.
 */

import { spawnSync } from 'child_process';

const SCRUBBED = ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_OBJECT_DIRECTORY'] as const;

/** process.env with externally-set git context vars removed. */
export function sanitizedGitEnv(): NodeJS.ProcessEnv {
	const env = { ...process.env };
	for (const key of SCRUBBED) delete env[key];
	return env;
}

/**
 * True if the Python `pre-commit` framework is dispatching this hook
 * (detected via its `PRE_COMMIT*` env vars). Used only for diagnostics —
 * does NOT change behavior.
 *
 * Note: `GIT_DIR` is intentionally NOT checked. Git sets `GIT_DIR` for
 * every hook invocation (Husky, native, anything), so it's not a useful
 * signal for "pre-commit framework specifically."
 */
export function isUnderPreCommit(): boolean {
	return Object.keys(process.env).some((k) => k.startsWith('PRE_COMMIT'));
}

/**
 * Staged files relative to the current working directory. `--relative`
 * filters siblings outside cwd and strips the cwd prefix in one shot.
 * Sanitized env ensures the index is read against the correct worktree
 * even when a parent process set GIT_DIR / GIT_WORK_TREE.
 */
export function getStagedFiles(): string[] {
	const result = spawnSync(
		'git',
		['diff', '--cached', '--name-only', '--diff-filter=ACMR', '--relative'],
		{ encoding: 'utf-8', env: sanitizedGitEnv() }
	);

	if (result.status !== 0) {
		console.error('Failed to get staged files');
		process.exit(1);
	}

	return result.stdout.trim().split('\n').filter(Boolean);
}
