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

export interface GitChange {
	status: 'A' | 'C' | 'D' | 'M' | 'R' | 'T';
	path: string;
	previousPath?: string;
}

/**
 * Staged changes relative to the current working directory. `--relative`
 * filters siblings outside cwd and strips the cwd prefix in one shot.
 * NUL-delimited name-status output preserves renames and unusual filenames.
 */
export function getStagedChanges(): GitChange[] {
	const result = spawnSync(
		'git',
		[
			'diff',
			'--cached',
			'--name-status',
			'-z',
			'--find-renames',
			'--find-copies',
			'--diff-filter=ACDMRT',
			'--relative'
		],
		{ encoding: 'utf-8', env: sanitizedGitEnv() }
	);

	if (result.status !== 0) {
		console.error('Failed to get staged changes');
		process.exit(1);
	}

	const fields = result.stdout.split('\0');
	if (fields.at(-1) === '') fields.pop();
	const changes: GitChange[] = [];
	for (let index = 0; index < fields.length;) {
		const statusField = fields[index++]!;
		const status = statusField[0] as GitChange['status'];
		if (status === 'R' || status === 'C') {
			const previousPath = fields[index++];
			const file = fields[index++];
			if (!previousPath || !file) throw new Error(`Malformed staged ${status} record.`);
			changes.push({ status, previousPath, path: file });
		} else {
			const file = fields[index++];
			if (!file) throw new Error(`Malformed staged ${status} record.`);
			changes.push({ status, path: file });
		}
	}
	return changes;
}

/** Files still present in the final index, for file-scoped checks and re-staging. */
export function getStagedFiles(): string[] {
	return getStagedChanges()
		.filter((change) => change.status !== 'D')
		.map((change) => change.path);
}
