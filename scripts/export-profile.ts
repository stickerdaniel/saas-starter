import { readdirSync, rmdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { inPathSets, pathSets, type PathSetName } from './path-sets';

function removeEmptyParents(root: string, path: string): void {
	for (let directory = dirname(path); directory !== '.'; directory = dirname(directory)) {
		if (readdirSync(join(root, directory)).length > 0) return;
		rmdirSync(join(root, directory));
	}
}

/**
 * Deletes the files of the named sets among `files`, the template's own paths under `root`,
 * and returns the deleted paths, sorted. A file outside `files` stays, and so does its directory.
 */
export function deletePathSets(
	root: string,
	files: readonly string[],
	names: readonly PathSetName[]
): string[] {
	const deleted = files.filter((path) => inPathSets(path, names)).sort();
	for (const path of deleted) {
		rmSync(join(root, path));
		removeEmptyParents(root, path);
	}
	return deleted;
}

interface Manifest {
	scripts: Record<string, string>;
	devDependencies: Record<string, string>;
}

/** Returns the text of `package.json` for a tree without the named sets. */
export function reduceManifest(text: string, names: readonly PathSetName[]): string {
	if (names.length === 0) return text;
	const manifest: Manifest = JSON.parse(text);
	for (const name of names) {
		const set = pathSets[name];
		for (const script of set.removedScripts) delete manifest.scripts[script];
		Object.assign(manifest.scripts, set.replacedScripts);
		for (const dependency of set.devDependencies) delete manifest.devDependencies[dependency];
	}
	return `${JSON.stringify(manifest, null, '\t')}\n`;
}
