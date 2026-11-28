import { posix } from 'node:path';
import {
	isStarterWorkspace,
	PRODUCED_FILES,
	WORKSPACES,
	type StarterWorkspace
} from '../../.agents/skills/upstream-sync/layout/v3.ts';
import { saveManifests } from './manifests.ts';
import {
	compareCodeUnits,
	isSuiteFile,
	StaleInput,
	treeFiles,
	type KeptAlias,
	type Run
} from './run.ts';
import {
	exportProblems,
	readPackageImports,
	readWorkspacePackages
} from './tree/workspace-exports.ts';

const RESOLVED_SUFFIXES = ['', '.ts', '.svelte.ts', '.svelte', '/index.ts', '/index.js'];

export function unservedAliases(
	imports: ReadonlyMap<StarterWorkspace, Readonly<Record<string, string>>>,
	kept: readonly KeptAlias[]
): string[] {
	return kept.flatMap((alias) => {
		const path = alias.specifier.split('?')[0]!;
		const entry = Object.entries(imports.get(alias.owner) ?? {}).find(([key]) =>
			path.startsWith(key.slice(0, -1))
		);
		if (entry) {
			const [key, value] = entry;
			const resolved = posix.join(
				WORKSPACES[alias.owner].root,
				value.slice(0, -1) + path.slice(key.length - 1)
			);
			const base = resolved.replace(/\.js$/, '');
			if (RESOLVED_SUFFIXES.some((suffix) => [resolved, base + suffix].includes(alias.target)))
				return [];
		}
		return [
			`${alias.owner}: ${alias.specifier} resolves to ${alias.target} under no imports entry`
		];
	});
}

/**
 * Writes each manifest's `imports` from the prefix entries the mapper keeps per workspace and
 * alias, and stops when a kept alias import resolves under none of them.
 */
export function writeImports(run: Run): void {
	const written = new Map<StarterWorkspace, Record<string, string>>();
	for (const { owner, prefix, key, root } of run.aliasEntries) {
		if (!isStarterWorkspace(owner) || owner === 'root') continue;
		if (prefix === '$lib/' && owner === 'web') continue;
		if (!prefix.startsWith('#')) {
			throw new StaleInput(
				`The mapper keeps ${prefix} in ${owner}, which no imports map can serve`
			);
		}
		const directory = posix.relative(WORKSPACES[owner].root, root);
		written.set(owner, {
			...written.get(owner),
			[`${key}*`]: `./${directory ? `${directory}/` : ''}*`
		});
	}
	const unserved = unservedAliases(written, run.keptAliases);
	if (unserved.length)
		throw new StaleInput(`The imports maps miss kept aliases:\n${unserved.join('\n')}`);
	for (const [owner, imports] of written) {
		const manifest = run.manifests.get(owner);
		if (!manifest) throw new Error(`No manifest for ${owner}`);
		manifest.imports = imports;
	}
	saveManifests(run);
}

/** Writes the one `exports` entry of each target that another workspace imports. */
export function writeExports(run: Run): void {
	for (const [owner, exports] of run.exportEntries) {
		const manifest = run.manifests.get(owner);
		if (!manifest) throw new Error(`No manifest for ${owner}`);
		manifest.exports = Object.fromEntries(
			Object.entries({ ...manifest.exports, ...exports }).sort(([a], [b]) => compareCodeUnits(a, b))
		);
	}
	saveManifests(run);
}

/** Stops when an `exports` map of the generated tree does not fit its imports. */
export function checkExports(run: Run): void {
	const files = treeFiles(run);
	const present = new Set([
		...files,
		...PRODUCED_FILES.flatMap(({ outputs }) =>
			outputs.flatMap((output) => run.table.place(output)?.to ?? [])
		)
	]);
	const packages = readWorkspacePackages(run.checkout, files);
	const problems = exportProblems(
		packages,
		readPackageImports(run.checkout, files, packages, isSuiteFile),
		(path) => present.has(path)
	);
	if (problems.length)
		throw new StaleInput(`The exports maps do not fit the tree:\n${problems.join('\n')}`);
}
