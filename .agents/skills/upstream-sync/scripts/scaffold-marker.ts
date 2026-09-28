/**
 * scaffold-marker.ts: read the CLI's `.saas-starter-scaffold.json` the way its first
 * commit recorded it.
 *
 * packages/create-saas-starter writes the exact template commit into this marker. An
 * edit after that commit must not move the fork point, so Git history wins over the
 * working tree. Only a marker Git has never committed, as in the CLI flow before
 * `git init`, is read from the working tree.
 *
 * Shared by find-fork-point.ts and scripts/template-setup.ts; setup runs before
 * dependencies are installed, so this module imports Node built-ins only.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';

export const SCAFFOLD_MARKER = '.saas-starter-scaffold.json';

export interface ScaffoldMarkerRead {
	marker: Record<string, unknown>;
	/** True when `marker` comes from the commit that first added the file. */
	committed: boolean;
	/** The working-tree sha when it differs from the committed original. */
	editedSha?: unknown;
}

function git(root: string, args: string[]): string | undefined {
	const env = { ...process.env };
	for (const key of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_OBJECT_DIRECTORY']) {
		delete env[key];
	}
	const r = spawnSync('git', args, { cwd: root, encoding: 'utf-8', env });
	return r.status === 0 ? r.stdout.trim() : undefined;
}

function parse(text: string | undefined): Record<string, unknown> | null {
	if (text === undefined) return null;
	try {
		const value: unknown = JSON.parse(text);
		return value && typeof value === 'object' && !Array.isArray(value)
			? (value as Record<string, unknown>)
			: null;
	} catch {
		return null;
	}
}

/** `root` is the repository (or scaffold) root; returns null when no marker exists. */
export function readScaffoldMarker(root: string): ScaffoldMarkerRead | null {
	let working: Record<string, unknown> | null;
	try {
		working = parse(readFileSync(join(root, SCAFFOLD_MARKER), 'utf-8'));
	} catch {
		working = null;
	}
	// History counts only when `root` is the repository itself, not a directory
	// inside some unrelated enclosing repository.
	const toplevel = git(root, ['rev-parse', '--show-toplevel']);
	const ownRepository = !!toplevel && realpathSync(toplevel) === realpathSync(root);
	const adds = ownRepository
		? git(root, ['log', '--diff-filter=A', '--format=%H', '--', `:(top)${SCAFFOLD_MARKER}`])
		: undefined;
	const first = adds?.split('\n').filter(Boolean).at(-1);
	const committed = first ? parse(git(root, ['show', `${first}:${SCAFFOLD_MARKER}`])) : null;
	if (committed) {
		const edited = working && working.sha !== committed.sha ? working.sha : undefined;
		return { marker: committed, committed: true, editedSha: edited };
	}
	return working ? { marker: working, committed: false } : null;
}
