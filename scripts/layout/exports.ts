import { posix } from 'node:path';
import { WORKSPACES, type StarterWorkspace } from '../../.agents/skills/upstream-sync/layout/v3.ts';
import { inPathSets, type Tree, type WorkspaceRoot } from '../path-sets.ts';
import { editSpecifiers } from './mapper-steps.ts';
import { saveManifests } from './manifests.ts';
import { StaleInput, type Rewrite, type Run } from './run.ts';
import {
	exportProblems,
	readPackageImports,
	readWorkspacePackages
} from './tree/workspace-exports.ts';

export const WORKSPACE_TREE: Tree = {
	layout: 'workspace',
	workspaces: (
		Object.values(WORKSPACES).map((workspace) => workspace.root) as WorkspaceRoot[]
	).filter((root) => root !== '')
};

export const isSuiteFile = (path: string): boolean => inPathSets(WORKSPACE_TREE, path, ['tests']);

const stem = (segment: string) => segment.replace(/(?:\.svelte)?\.[^.]+$/, '');

/**
 * Every way one kept alias import splits into an imports entry: the alias key below the prefix
 * and the directory it maps to, for each run of trailing path segments the specifier shares with
 * its target. The last segment may differ in its extension or name a directory's index file.
 */
function aliasSplits(rest: string, targetInWorkspace: string): Set<string> {
	const named = rest.split('/');
	const placed = targetInWorkspace.split('/');
	if (placed.length > 1 && placed.at(-1)!.startsWith('index.') && named.at(-1) === placed.at(-2)) {
		placed.pop();
	} else if (named.at(-1) !== placed.at(-1) && stem(named.at(-1)!) !== stem(placed.at(-1)!)) {
		return new Set();
	}
	const splits = new Set<string>();
	for (let shared = 1; shared <= Math.min(named.length, placed.length); shared += 1) {
		if (shared > 1 && named.at(-shared) !== placed.at(-shared)) break;
		const directory = (parts: readonly string[]) =>
			parts
				.slice(0, parts.length - shared)
				.map((part) => `${part}/`)
				.join('');
		splits.add(`${directory(named)}\t${directory(placed)}`);
	}
	return splits;
}

/**
 * Writes each manifest's `imports` from the alias imports the mapper keeps: per workspace and
 * alias, the one entry that serves every kept import of that alias, the shortest among several.
 */
export function writeImports(run: Run): void {
	const candidates = new Map<string, Set<string>>();
	for (const kept of run.keptAliases) {
		const rest = kept.specifier.split('?')[0]!.slice(kept.prefix.length);
		const splits = aliasSplits(rest, kept.target.slice(WORKSPACES[kept.owner].root.length));
		const group = `${kept.owner}\t${kept.prefix}`;
		const known = candidates.get(group);
		candidates.set(
			group,
			known ? new Set([...known].filter((split) => splits.has(split))) : splits
		);
		if (!candidates.get(group)!.size) {
			throw new StaleInput(
				`No imports entry of ${kept.owner} serves ${kept.specifier} with the other kept ${kept.prefix} imports`
			);
		}
	}
	const entries = new Map<StarterWorkspace, Record<string, string>>();
	for (const [group, splits] of [...candidates].sort(([a], [b]) => a.localeCompare(b))) {
		const [owner, prefix] = group.split('\t') as [StarterWorkspace, string];
		if (prefix === '$lib/' && owner === 'web') continue;
		if (!prefix.startsWith('#') || !run.aliases.has(prefix)) {
			throw new StaleInput(
				`The mapper keeps ${prefix} in ${owner}, which no imports map can serve`
			);
		}
		const [key, directory] = [...splits]
			.map((split) => split.split('\t') as [string, string])
			.sort(([a], [b]) => a.length - b.length || a.localeCompare(b))[0]!;
		entries.set(owner, { ...entries.get(owner), [`${prefix}${key}*`]: `./${directory}*` });
	}
	for (const [owner, imports] of entries) {
		const manifest = run.manifests.get(owner);
		if (!manifest) throw new Error(`No manifest for ${owner}`);
		manifest.imports = imports;
	}
	saveManifests(run);
}

function packageSpecifier(
	rewrite: Rewrite
): { name: string; subpath: string; query: string } | undefined {
	const { name } = WORKSPACES[rewrite.targetOwner];
	if (name === null || rewrite.next.startsWith('.')) return undefined;
	const [bare = '', query = ''] = rewrite.next.split(/(?=\?)/);
	if (!bare.startsWith(`${name}/`)) return undefined;
	return { name, subpath: bare.slice(name.length + 1), query };
}

/**
 * Writes one `exports` entry for every target a file of another workspace imports. A target that
 * only suite files import gets its entry under `./testing/`, and its importers name that subpath.
 */
export function writeExports(run: Run): void {
	const groups = new Map<string, Array<{ rewrite: Rewrite; subpath: string; query: string }>>();
	for (const rewrite of run.rewrites) {
		const specifier = packageSpecifier(rewrite);
		if (!specifier) continue;
		const group = `${rewrite.targetOwner}\t${specifier.subpath}\t${rewrite.target}`;
		groups.set(group, [...(groups.get(group) ?? []), { rewrite, ...specifier }]);
	}
	const entries = new Map<StarterWorkspace, Record<string, string>>();
	const edits = [];
	for (const [group, importers] of groups) {
		const [owner, subpath, target] = group.split('\t') as [StarterWorkspace, string, string];
		const testing = importers.every(({ rewrite }) => isSuiteFile(rewrite.file));
		const key = testing ? `./testing/${subpath}` : `./${subpath}`;
		const value = `./${posix.relative(WORKSPACES[owner].root, target)}`;
		const current = entries.get(owner) ?? {};
		if (current[key] !== undefined && current[key] !== value) {
			throw new StaleInput(
				`${WORKSPACES[owner].name} would export ${key} as ${current[key]} and ${value}`
			);
		}
		entries.set(owner, { ...current, [key]: value });
		if (testing) {
			for (const { rewrite, query } of importers) {
				edits.push({
					file: rewrite.file,
					line: rewrite.line,
					from: rewrite.next,
					to: `${WORKSPACES[owner].name}/testing/${subpath}${query}`
				});
			}
		}
	}
	editSpecifiers(run.checkout, edits);
	for (const [owner, exports] of entries) {
		const manifest = run.manifests.get(owner);
		if (!manifest) throw new Error(`No manifest for ${owner}`);
		manifest.exports = Object.fromEntries(
			Object.entries({ ...manifest.exports, ...exports }).sort(([a], [b]) => a.localeCompare(b))
		);
	}
	saveManifests(run);
}

/** Stops when an `exports` map of the generated tree does not fit its imports. */
export function checkExports(run: Run): void {
	const packages = readWorkspacePackages(run.checkout);
	const problems = exportProblems(
		packages,
		readPackageImports(run.checkout, packages, isSuiteFile)
	);
	if (problems.length)
		throw new StaleInput(`The exports maps do not fit the tree:\n${problems.join('\n')}`);
}
