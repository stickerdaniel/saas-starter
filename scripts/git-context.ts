/**
 * Git context helpers for scripts that run inside hooks.
 *
 * A parent hook may set Git context variables before invoking checks from a
 * nested application directory. Staged readers must keep the active commit
 * index when it belongs to this invocation and discard a foreign repository's
 * context.
 */

import { spawnSync } from 'child_process';
import { existsSync, lstatSync, readFileSync, readlinkSync, realpathSync } from 'fs';
import path from 'path';

const SCRUBBED = [
	'GIT_ALTERNATE_OBJECT_DIRECTORIES',
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
	'GIT_WORK_TREE'
] as const;

/** process.env with externally set Git context variables removed. */
export function sanitizedGitEnv(): NodeJS.ProcessEnv {
	const env = { ...process.env };
	const scrubbed = new Set<string>(SCRUBBED);
	for (const key of Object.keys(env)) {
		if (scrubbed.has(key.toUpperCase())) delete env[key];
	}
	return env;
}

function stripFinalLineEnding(value: string): string {
	return value.endsWith('\r\n')
		? value.slice(0, -2)
		: value.endsWith('\n')
			? value.slice(0, -1)
			: value;
}

function gitPath(cwd: string, env: NodeJS.ProcessEnv, argument: string): string {
	const result = spawnSync('git', ['rev-parse', argument], { cwd, env, encoding: 'utf-8' });
	if (result.status !== 0) throw new Error(`Failed to resolve Git path ${argument}.`);
	return realpathSync(stripFinalLineEnding(result.stdout));
}

function envPathPointsElsewhere(
	value: string | undefined,
	expected: string,
	root: string
): boolean {
	if (!value) return false;
	try {
		return realpathSync(path.resolve(root, value)) !== expected;
	} catch {
		return true;
	}
}

function resolveDirectory(value: string, root: string, label: string): string {
	const resolved = path.isAbsolute(value) ? value : path.resolve(root, value);
	try {
		const canonical = realpathSync(resolved);
		if (!lstatSync(canonical).isDirectory()) throw new Error();
		return canonical;
	} catch {
		throw new Error(`${label} is not a directory.`);
	}
}

function temporaryIndexOwner(candidateDirectory: string): string | undefined {
	let worktree: string | undefined;
	if (path.basename(candidateDirectory) === '.git') {
		worktree = path.dirname(candidateDirectory);
	} else {
		const gitdirFile = path.join(candidateDirectory, 'gitdir');
		if (!existsSync(gitdirFile)) return undefined;
		const worktreeGitFile = stripFinalLineEnding(readFileSync(gitdirFile, 'utf8'));
		worktree = path.dirname(path.resolve(candidateDirectory, worktreeGitFile));
	}

	try {
		return gitPath(worktree, sanitizedGitEnv(), '--absolute-git-dir') === candidateDirectory
			? realpathSync(worktree)
			: undefined;
	} catch {
		return undefined;
	}
}

function isNestedParentTemporaryIndex(
	candidate: string,
	candidateDirectory: string,
	worktree: string
): boolean {
	if (!/^(?:index\.lock|next-index-\d+\.lock)$/.test(path.basename(candidate))) return false;
	const owner = temporaryIndexOwner(candidateDirectory);
	return owner !== undefined && worktree.startsWith(`${owner}${path.sep}`);
}

/** Preserve an active index and its explicit object stores for this invocation. */
export function stagedGitEnv(cwd = process.cwd()): NodeJS.ProcessEnv {
	const env = sanitizedGitEnv();
	const rawIndex = process.env.GIT_INDEX_FILE;
	const rawObjectDirectory = process.env.GIT_OBJECT_DIRECTORY;
	const rawAlternates = process.env.GIT_ALTERNATE_OBJECT_DIRECTORIES;
	if (!rawIndex && !rawObjectDirectory && !rawAlternates) return env;

	const gitDirectory = gitPath(cwd, env, '--absolute-git-dir');
	const worktree = gitPath(cwd, env, '--show-toplevel');
	const foreignContext =
		envPathPointsElsewhere(process.env.GIT_DIR, gitDirectory, worktree) ||
		envPathPointsElsewhere(process.env.GIT_WORK_TREE, worktree, worktree);

	if (rawIndex) {
		const candidate = path.isAbsolute(rawIndex) ? rawIndex : path.resolve(worktree, rawIndex);
		const candidateDirectory = realpathSync(path.dirname(candidate));
		if (candidateDirectory !== gitDirectory) {
			const externalAllowed = process.env.STATIC_CHECKS_ALLOW_EXTERNAL_GIT_INDEX === '1';
			if (!externalAllowed && foreignContext) return env;
			if (
				!externalAllowed &&
				isNestedParentTemporaryIndex(candidate, candidateDirectory, worktree)
			) {
				return env;
			}
			if (!externalAllowed) {
				throw new Error(
					'External GIT_INDEX_FILE requires STATIC_CHECKS_ALLOW_EXTERNAL_GIT_INDEX=1.'
				);
			}
		}
		if (!existsSync(candidate) || !lstatSync(candidate).isFile()) {
			throw new Error('The active GIT_INDEX_FILE is not a regular file.');
		}
		env.GIT_INDEX_FILE = candidate;
	}

	const preserveObjectStores = !foreignContext || env.GIT_INDEX_FILE !== undefined;
	if (preserveObjectStores && rawObjectDirectory) {
		env.GIT_OBJECT_DIRECTORY = resolveDirectory(
			rawObjectDirectory,
			worktree,
			'The active GIT_OBJECT_DIRECTORY'
		);
	}
	if (preserveObjectStores && rawAlternates) {
		env.GIT_ALTERNATE_OBJECT_DIRECTORIES = rawAlternates;
	}
	return env;
}

/** Path to the index that staged Git commands will read. */
export function activeGitIndexPath(cwd = process.cwd(), env = stagedGitEnv(cwd)): string {
	if (env.GIT_INDEX_FILE) return realpathSync(env.GIT_INDEX_FILE);
	const result = spawnSync('git', ['rev-parse', '--path-format=absolute', '--git-path', 'index'], {
		cwd,
		env,
		encoding: 'utf-8'
	});
	if (result.status !== 0) throw new Error('Failed to resolve the active Git index.');
	return realpathSync(stripFinalLineEnding(result.stdout));
}

/** Stable fingerprint of the complete active index, including extended flags. */
export function activeGitIndexFingerprint(cwd = process.cwd(), env = stagedGitEnv(cwd)): string {
	const result = spawnSync(
		'git',
		['hash-object', '--no-filters', '--', activeGitIndexPath(cwd, env)],
		{
			cwd,
			env: sanitizedGitEnv(),
			encoding: 'utf-8'
		}
	);
	if (result.status !== 0) throw new Error('Failed to fingerprint the active Git index.');
	return stripFinalLineEnding(result.stdout);
}

export interface GitChange {
	status: 'A' | 'C' | 'D' | 'M' | 'R' | 'T';
	path: string;
	previousPath?: string;
}

/** Staged changes filtered and relativized to the current directory. */
export function getStagedChanges(cwd = process.cwd(), env = stagedGitEnv(cwd)): GitChange[] {
	const result = spawnSync(
		'git',
		[
			'--no-replace-objects',
			'diff',
			'--cached',
			'--name-status',
			'-z',
			'--find-renames',
			'--find-copies',
			'--diff-filter=ACDMRT',
			'--relative'
		],
		{ cwd, encoding: 'utf-8', env }
	);
	if (result.status !== 0) throw new Error('Failed to get staged changes.');

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

/** Files present in the final index. */
export function getStagedFiles(cwd = process.cwd(), env = stagedGitEnv(cwd)): string[] {
	return getStagedChanges(cwd, env)
		.filter((change) => change.status !== 'D')
		.map((change) => change.path);
}

/** Staged paths whose worktree bytes pass through a custom Git clean filter. */
export function stagedFilesWithCleanFilters(
	files: string[],
	cwd = process.cwd(),
	env = stagedGitEnv(cwd)
): string[] {
	if (files.length === 0) return [];
	const result = spawnSync('git', ['check-attr', '-z', '--stdin', 'filter'], {
		cwd,
		env,
		encoding: 'utf8',
		input: `${files.join('\0')}\0`,
		maxBuffer: 16 * 1024 * 1024
	});
	if (result.status !== 0) throw new Error('Failed to inspect Git clean filters.');
	const fields = result.stdout.split('\0');
	if (fields.at(-1) === '') fields.pop();
	if (fields.length !== files.length * 3) throw new Error('Malformed Git attribute response.');
	const filtered: string[] = [];
	for (let index = 0; index < fields.length; index += 3) {
		const [file, attribute, value] = fields.slice(index, index + 3);
		if (file !== files[index / 3] || attribute !== 'filter' || !value) {
			throw new Error('Malformed Git attribute response.');
		}
		if (value !== 'unspecified' && value !== 'unset') filtered.push(file);
	}
	return filtered;
}

export interface GitIndexEntry {
	mode: string;
	objectId: string;
	path: string;
}

export function getStageZeroIndexEntries(
	files: string[],
	cwd = process.cwd(),
	env = stagedGitEnv(cwd)
): GitIndexEntry[] {
	if (files.length === 0) return [];
	const result = spawnSync('git', ['ls-files', '--stage', '-z'], {
		cwd,
		encoding: 'utf-8',
		env,
		maxBuffer: 64 * 1024 * 1024
	});
	if (result.status !== 0) throw new Error('Failed to read staged index entries.');

	const requested = new Set(files);
	const entries = new Map<string, Array<GitIndexEntry & { stage: number }>>();
	for (const record of result.stdout.split('\0').filter(Boolean)) {
		const separator = record.indexOf('\t');
		const metadata = separator < 0 ? [] : record.slice(0, separator).split(' ');
		const file = separator < 0 ? '' : record.slice(separator + 1);
		if (!requested.has(file)) continue;
		const [mode, objectId, stageText] = metadata;
		if (
			!mode ||
			!objectId ||
			!stageText ||
			!/^[0-7]{6}$/.test(mode) ||
			!/^[0-9a-f]{40,64}$/.test(objectId) ||
			!/^[0-3]$/.test(stageText)
		) {
			throw new Error('Malformed staged index entry.');
		}
		const matches = entries.get(file) ?? [];
		matches.push({ mode, objectId, path: file, stage: Number(stageText) });
		entries.set(file, matches);
	}

	return files.map((file) => {
		const matches = entries.get(file) ?? [];
		if (matches.length !== 1 || matches[0]!.stage !== 0) {
			throw new Error(`Missing or ambiguous stage-zero index entry for ${JSON.stringify(file)}.`);
		}
		const { mode, objectId, path: entryPath } = matches[0]!;
		return { mode, objectId, path: entryPath };
	});
}

type WorktreeObject = { kind: 'file' | 'symlink' | 'gitlink'; id: string };

function hashWorktreePaths(
	entries: GitIndexEntry[],
	cwd: string,
	env: NodeJS.ProcessEnv
): Map<string, WorktreeObject> {
	const objects = new Map<string, WorktreeObject>();
	const regularFiles: string[] = [];
	const rawFiles: string[] = [];
	for (const entry of entries) {
		const file = entry.path;
		const absolute = path.resolve(cwd, file);
		const stat = lstatSync(absolute);
		if (stat.isDirectory()) {
			const result = spawnSync('git', ['-C', absolute, 'rev-parse', 'HEAD'], {
				env: sanitizedGitEnv(),
				encoding: 'utf-8'
			});
			if (result.status !== 0) throw new Error(`Failed to read gitlink ${JSON.stringify(file)}.`);
			objects.set(file, { kind: 'gitlink', id: stripFinalLineEnding(result.stdout) });
		} else if (stat.isSymbolicLink()) {
			const result = spawnSync('git', ['hash-object', '--stdin'], {
				cwd,
				env,
				encoding: 'utf-8',
				input: readlinkSync(absolute, { encoding: 'buffer' })
			});
			if (result.status !== 0) {
				throw new Error(`Failed to hash worktree path ${JSON.stringify(file)}.`);
			}
			objects.set(file, { kind: 'symlink', id: stripFinalLineEnding(result.stdout) });
		} else if (stat.isFile()) {
			(entry.mode === '120000' ? rawFiles : regularFiles).push(file);
		} else {
			throw new Error(`Unsupported worktree path type for ${JSON.stringify(file)}.`);
		}
	}

	const hashFiles = (files: string[], noFilters: boolean): void => {
		if (files.length === 0) return;
		if (files.some((file) => /[\r\n]/.test(file))) {
			throw new Error('A worktree path cannot be passed safely to Git hash-object.');
		}
		const result = spawnSync(
			'git',
			['hash-object', ...(noFilters ? ['--no-filters'] : []), '--stdin-paths'],
			{
				cwd,
				env,
				encoding: 'utf-8',
				input: `${files.map((file) => path.resolve(cwd, file)).join('\n')}\n`,
				maxBuffer: 16 * 1024 * 1024
			}
		);
		if (result.status !== 0) throw new Error('Failed to hash staged worktree paths.');
		const objectIds = result.stdout.split('\n').filter(Boolean);
		if (objectIds.length !== files.length) throw new Error('Malformed Git hash response.');
		for (let index = 0; index < files.length; index++) {
			objects.set(files[index]!, { kind: 'file', id: objectIds[index]! });
		}
	};
	hashFiles(regularFiles, false);
	hashFiles(rawFiles, true);
	return objects;
}

/** Whether every checked worktree byte sequence is the exact staged object. */
export function stagedFilesMatchWorktree(
	files: string[],
	cwd = process.cwd(),
	env = stagedGitEnv(cwd)
): boolean {
	const entries = getStageZeroIndexEntries(files, cwd, env);
	const worktreeObjects = hashWorktreePaths(entries, cwd, env);
	return entries.every((entry) => {
		const worktree = worktreeObjects.get(entry.path)!;
		if (entry.mode === '160000') {
			return worktree.kind === 'gitlink' && worktree.id === entry.objectId;
		}
		if (entry.mode === '120000') {
			return (
				(worktree.kind === 'symlink' || worktree.kind === 'file') && worktree.id === entry.objectId
			);
		}
		if (entry.mode === '100644' || entry.mode === '100755') {
			return worktree.kind === 'file' && worktree.id === entry.objectId;
		}
		throw new Error(`Unsupported Git index mode ${entry.mode}.`);
	});
}
