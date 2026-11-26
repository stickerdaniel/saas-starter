import { readdirSync, rmdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { inPathSets, pathSets, type PathSetName } from './path-sets';

const skippedDirectories = new Set(['.git', 'node_modules']);

function treeFiles(root: string, directory = ''): string[] {
	return readdirSync(join(root, directory), { withFileTypes: true }).flatMap((entry) => {
		const path = directory ? `${directory}/${entry.name}` : entry.name;
		if (!entry.isDirectory()) return [path];
		return skippedDirectories.has(entry.name) ? [] : treeFiles(root, path);
	});
}

function removeEmptyParents(root: string, path: string): void {
	for (let directory = dirname(path); directory !== '.'; directory = dirname(directory)) {
		if (readdirSync(join(root, directory)).length > 0) return;
		rmdirSync(join(root, directory));
	}
}

/** Deletes every file of the named sets under `root` and returns the deleted paths, sorted. */
export function deletePathSets(root: string, names: readonly PathSetName[]): string[] {
	const deleted = treeFiles(root)
		.filter((path) => inPathSets(path, names))
		.sort();
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
	const manifest: Manifest = JSON.parse(text);
	for (const name of names) {
		const set = pathSets[name];
		for (const script of set.removedScripts) delete manifest.scripts[script];
		Object.assign(manifest.scripts, set.replacedScripts);
		for (const dependency of set.devDependencies) delete manifest.devDependencies[dependency];
	}
	return `${JSON.stringify(manifest, null, '\t')}\n`;
}
