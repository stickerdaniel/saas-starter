import { spawnSync } from 'node:child_process';
import { lstatSync, readdirSync, realpathSync, rmdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { inPathSets, pathSets, type PathSetName } from './path-sets';

/** `path` when it is a relative path with forward slashes and no empty, `.` or `..` segment. */
export function checkedPath(path: string): string {
	if (/^[A-Za-z]:|^\//.test(path) || path.includes('\\')) {
		throw new Error(`Refusing inventory path ${JSON.stringify(path)}: it must be relative`);
	}
	if (path.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')) {
		throw new Error(
			`Refusing inventory path ${JSON.stringify(path)}: it has an empty, . or .. segment`
		);
	}
	return path;
}

function git(root: string, ...args: string[]): string {
	const env = { ...process.env };
	for (const key of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_OBJECT_DIRECTORY']) {
		delete env[key];
	}
	const result = spawnSync('git', ['-c', 'core.quotePath=false', ...args], {
		cwd: root,
		encoding: 'utf8',
		env,
		maxBuffer: 256 * 1024 * 1024
	});
	if (result.status !== 0) {
		throw new Error(`git ${args.join(' ')} exited with ${result.status}: ${result.stderr.trim()}`);
	}
	return result.stdout;
}

/** The paths in the index of the repository whose top level is `root`. */
export function trackedFiles(root: string): string[] {
	const toplevel = git(root, 'rev-parse', '--show-toplevel').trim();
	if (realpathSync(toplevel) !== realpathSync(root)) {
		throw new Error(`${root} is not the top level of its Git repository`);
	}
	const paths = new Set(git(root, 'ls-files', '-z').split('\0').filter(Boolean));
	return [...paths].map(checkedPath);
}

/** Every file under `root`, a directory that holds an extracted template archive. */
export function archiveFiles(root: string): string[] {
	const files: string[] = [];
	const visit = (directory: string): void => {
		for (const entry of readdirSync(join(root, directory), { withFileTypes: true })) {
			const path = directory ? `${directory}/${entry.name}` : entry.name;
			if (entry.isDirectory()) visit(path);
			else files.push(checkedPath(path));
		}
	};
	visit('');
	return files;
}

function removeEmptyParents(root: string, path: string): void {
	for (let directory = dirname(path); directory !== '.'; directory = dirname(directory)) {
		if (readdirSync(join(root, directory)).length > 0) return;
		rmdirSync(join(root, directory));
	}
}

/** A deletion that stopped at `path` after it had deleted the files in `deleted`. */
export class PathSetDeletionError extends Error {
	constructor(
		readonly deleted: readonly string[],
		readonly path: string,
		cause: unknown
	) {
		super(`Could not delete ${path}: ${cause instanceof Error ? cause.message : String(cause)}`, {
			cause
		});
	}
}

function assertInsideRoot(root: string, path: string): void {
	for (let directory = dirname(path); directory !== '.'; directory = dirname(directory)) {
		const stats = lstatSync(join(root, directory), { throwIfNoEntry: false });
		if (stats && !stats.isDirectory()) throw new Error(`its ancestor ${directory} is no directory`);
	}
}

/** Whether `path` exists under `root`; throws unless it is a regular file below real directories. */
function isPresentFile(root: string, path: string): boolean {
	assertInsideRoot(root, path);
	const stats = lstatSync(join(root, path), { throwIfNoEntry: false });
	if (stats && !stats.isFile()) throw new Error('it is no regular file');
	return stats !== undefined;
}

/**
 * Deletes the files of the named sets among `files`, the template's own paths under `root`,
 * and returns the paths it deleted, sorted. A file outside `files` stays, and so does its
 * directory. A listed file that is already gone is skipped, and no directory is removed for it.
 * Before the first deletion every listed path must lie below real directories only and be a
 * regular file when it exists, so no deletion follows a link out of `root`.
 */
export function deletePathSets(
	root: string,
	files: readonly string[],
	names: readonly PathSetName[]
): string[] {
	const paths = files.filter((file) => inPathSets(file, names)).sort();
	for (const path of paths) {
		try {
			isPresentFile(root, path);
		} catch (error) {
			throw new PathSetDeletionError([], path, error);
		}
	}
	const deleted: string[] = [];
	for (const path of paths) {
		try {
			if (!isPresentFile(root, path)) continue;
			rmSync(join(root, path));
		} catch (error) {
			throw new PathSetDeletionError(deleted, path, error);
		}
		deleted.push(path);
		try {
			removeEmptyParents(root, path);
		} catch (error) {
			throw new PathSetDeletionError(deleted, dirname(path), error);
		}
	}
	return deleted;
}

interface Manifest {
	scripts: Record<string, string>;
	devDependencies: Record<string, string>;
}

/**
 * Returns the text of `package.json` for a tree without the named sets. Per set the manifest is
 * full, with every removed script, or reduced, with none of the removed scripts and none of the
 * dependencies, and a reduced manifest keeps its text. Any other manifest throws.
 */
export function reduceManifest(text: string, names: readonly PathSetName[]): string {
	const manifest: Manifest = JSON.parse(text);
	let reduced = false;
	for (const name of names) {
		const set = pathSets[name];
		const scripts = set.removedScripts.filter((script) => Object.hasOwn(manifest.scripts, script));
		const dependencies = set.devDependencies.filter((dependency) =>
			Object.hasOwn(manifest.devDependencies, dependency)
		);
		if (scripts.length === 0 && dependencies.length === 0) continue;
		if (scripts.length < set.removedScripts.length) {
			throw new Error(
				`package.json is neither full nor reduced for the ${name} set: it names the scripts ` +
					`${JSON.stringify(scripts)} and the devDependencies ${JSON.stringify(dependencies)}`
			);
		}
		for (const script of scripts) delete manifest.scripts[script];
		Object.assign(manifest.scripts, set.replacedScripts);
		for (const dependency of dependencies) delete manifest.devDependencies[dependency];
		reduced = true;
	}
	return reduced ? `${JSON.stringify(manifest, null, '\t')}\n` : text;
}
