import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, posix } from 'node:path';
import {
	aliasImportEntries,
	aliasMap,
	checkTotality,
	compareCodeUnits,
	loadTable,
	plannedSpecifiers,
	readImportEdges,
	trackedPaths,
	type AliasImportEntry,
	type ImportEdge
} from '../../.agents/skills/upstream-sync/scripts/apply-layout.ts';
import {
	WORKSPACES,
	type MoveTable,
	type StarterWorkspace
} from '../../.agents/skills/upstream-sync/layout/v3.ts';
import { inPathSets, type Tree, type WorkspaceRoot } from '../path-sets.ts';
import type { OwnerTables } from './owners.ts';
import type { ProjectFile } from './projects.ts';
import type { Replacement } from './replacements.ts';

export class StaleInput extends Error {}

export interface Inputs {
	readonly owners: OwnerTables;
	readonly projectFiles: readonly ProjectFile[];
	readonly replacements: readonly Replacement[];
}

export { compareCodeUnits };

export type Manifest = Record<string, unknown> & {
	name?: string;
	scripts?: Record<string, string>;
	dependencies?: Record<string, string>;
	devDependencies?: Record<string, string>;
	peerDependencies?: Record<string, string>;
	overrides?: Record<string, string>;
	imports?: Record<string, string>;
	exports?: Record<string, string>;
};

/** One import of the flat tree that the mapper rewrites, joined with where both ends land. */
export interface Rewrite {
	readonly file: string;
	readonly owner: StarterWorkspace;
	readonly line: number;
	readonly literalOffset: number;
	readonly specifier: string;
	readonly next: string;
	readonly target: string;
	readonly targetOwner: StarterWorkspace;
}

/** One alias import of the flat tree that the mapper keeps, with where both ends land. */
export interface KeptAlias {
	readonly owner: StarterWorkspace;
	readonly prefix: string;
	readonly specifier: string;
	readonly flatTarget: string;
	readonly target: string;
}

/** What every step reads: the flat checkout as it was before the first step changed it. */
export interface Run {
	readonly checkout: string;
	readonly inputs: Inputs;
	readonly source: string;
	readonly table: MoveTable;
	readonly flatPaths: readonly string[];
	readonly rewrites: readonly Rewrite[];
	readonly exportEntries: ExportEntries;
	readonly keptAliases: readonly KeptAlias[];
	readonly aliasEntries: readonly AliasImportEntry[];
	/** The alias prefixes of the flat tree with the directories they name. */
	readonly aliases: ReadonlyMap<string, string>;
	readonly flatManifest: Manifest;
	/** Reads a file of the flat tree as the source commit holds it. */
	readonly flatFile: (path: string) => string;
	/** The workspace manifests the steps build, keyed by workspace. */
	readonly manifests: Map<StarterWorkspace, Manifest>;
	/** Development dependencies on workspaces that the generated project files import. */
	readonly projectEdges: Map<StarterWorkspace, Set<StarterWorkspace>>;
	readonly written: Set<string>;
}

function placed(
	table: MoveTable,
	path: string
): { to: string; owner: StarterWorkspace } | undefined {
	const placement = table.place(path);
	if (!placement?.to || !Object.hasOwn(WORKSPACES, placement.owner)) return undefined;
	return { to: placement.to, owner: placement.owner as StarterWorkspace };
}

function joinRewrites(table: MoveTable, edges: readonly ImportEdge[], checkout: string): Rewrite[] {
	const planned = new Map<string, string>();
	for (const change of plannedSpecifiers(table, edges, aliasMap(checkout))) {
		const key = `${change.file}\t${change.specifier}`;
		const known = planned.get(key);
		if (known !== undefined && known !== change.next) {
			throw new StaleInput(
				`The mapper rewrites ${change.specifier} in ${change.file} to ${known} and ${change.next}`
			);
		}
		planned.set(key, change.next);
	}
	const rewrites = edges.flatMap((edge) => {
		if (edge.kind !== 'import') return [];
		const from = placed(table, edge.from);
		const target = placed(table, edge.target);
		const next = from && planned.get(`${from.to}\t${edge.specifier}`);
		if (!from || !target || next === undefined) return [];
		return [
			{
				file: from.to,
				owner: from.owner,
				line: edge.line,
				literalOffset: edge.literalOffset,
				specifier: edge.specifier,
				next,
				target: target.to,
				targetOwner: target.owner
			}
		];
	});
	const joined = new Set(rewrites.map((rewrite) => `${rewrite.file}\t${rewrite.specifier}`));
	const unjoined = [...planned.keys()].filter((key) => !joined.has(key));
	if (unjoined.length) {
		throw new StaleInput(`The mapper plans rewrites for no import edge:\n${unjoined.join('\n')}`);
	}
	return rewrites;
}

function keepAliases(
	table: MoveTable,
	edges: readonly ImportEdge[],
	rewrites: readonly Rewrite[],
	checkout: string
): KeptAlias[] {
	const rewritten = new Set(rewrites.map((rewrite) => `${rewrite.file}\t${rewrite.specifier}`));
	const aliases = aliasMap(checkout);
	return edges.flatMap((edge) => {
		if (edge.kind !== 'import' || edge.target.startsWith('node_modules/')) return [];
		const prefix = aliases.find(([key]) => edge.specifier.startsWith(key))?.[0];
		const from = placed(table, edge.from);
		const target = placed(table, edge.target);
		if (!prefix || !from || !target || from.owner === 'root') return [];
		if (from.owner !== target.owner || rewritten.has(`${from.to}\t${edge.specifier}`)) return [];
		return [
			{
				owner: from.owner,
				prefix,
				specifier: edge.specifier,
				flatTarget: edge.target,
				target: target.to
			}
		];
	});
}

export const WORKSPACE_TREE: Tree = {
	layout: 'workspace',
	workspaces: (
		Object.values(WORKSPACES).map((workspace) => workspace.root) as WorkspaceRoot[]
	).filter((root) => root !== '')
};

export const isSuiteFile = (path: string): boolean => inPathSets(WORKSPACE_TREE, path, ['tests']);

export type ExportEntries = ReadonlyMap<StarterWorkspace, Readonly<Record<string, string>>>;

export function planExports(rewrites: readonly Rewrite[]): {
	rewrites: Rewrite[];
	entries: ExportEntries;
} {
	const groups = new Map<string, Rewrite[]>();
	for (const rewrite of rewrites) {
		const { name } = WORKSPACES[rewrite.targetOwner];
		if (name === null || rewrite.owner === rewrite.targetOwner || rewrite.next.startsWith('.')) {
			continue;
		}
		const group = `${rewrite.targetOwner}\t${rewrite.target}`;
		groups.set(group, [...(groups.get(group) ?? []), rewrite]);
	}
	const entries = new Map<StarterWorkspace, Record<string, string>>();
	const testing = new Map<Rewrite, string>();
	for (const [group, importers] of [...groups].sort(([a], [b]) => compareCodeUnits(a, b))) {
		const [owner, target] = group.split('\t') as [StarterWorkspace, string];
		const { name, root } = WORKSPACES[owner];
		if (name === null) continue;
		const spellings = new Set(importers.map(({ next }) => next.split('?')[0]!));
		if (spellings.size !== 1) {
			throw new StaleInput(`The mapper names ${target} as ${[...spellings].join(' and ')}`);
		}
		const subpath = [...spellings][0]!.slice(`${name}/`.length);
		const suite = importers.every(({ file }) => isSuiteFile(file));
		entries.set(owner, {
			...entries.get(owner),
			[suite ? `./testing/${subpath}` : `./${subpath}`]: `./${posix.relative(root, target)}`
		});
		if (suite) {
			for (const importer of importers) {
				testing.set(importer, `${name}/testing/${importer.next.slice(name.length + 1)}`);
			}
		}
	}
	return {
		rewrites: rewrites.map((rewrite) => {
			const next = testing.get(rewrite);
			return next === undefined ? rewrite : { ...rewrite, next };
		}),
		entries
	};
}

export function importsProblems(manifest: Manifest): string[] {
	const entries = Object.entries(manifest.imports ?? {});
	const problems = entries.flatMap(([key, value]: [string, unknown]) => {
		if (typeof value !== 'string') return [`The imports entry ${key} has a conditional value`];
		if (!key.endsWith('/*') || !value.endsWith('/*')) {
			return [`The imports entry ${key} is no wildcard pair of a directory`];
		}
		return [];
	});
	for (const [key] of entries) {
		for (const [other] of entries) {
			if (key !== other && other.startsWith(key.slice(0, -1))) {
				problems.push(`The imports entries ${key} and ${other} overlap`);
			}
		}
	}
	return problems;
}

export async function prepareRun(checkout: string, source: string, inputs: Inputs): Promise<Run> {
	const flatFile = (path: string): string => {
		const shown = spawnSync('git', ['show', `${source}:${path}`], {
			cwd: checkout,
			encoding: 'utf8',
			maxBuffer: 64 * 1024 * 1024
		});
		if (shown.status !== 0) throw new StaleInput(`${path} is no tracked file of ${source}`);
		return shown.stdout;
	};
	const { table, refusals } = await loadTable(checkout);
	if (refusals.length) throw new StaleInput(`The move table is refused:\n${refusals.join('\n')}`);
	const flatPaths = trackedPaths(checkout);
	const flatManifest: Manifest = JSON.parse(flatFile('package.json'));
	const unread = importsProblems(flatManifest);
	if (unread.length) throw new StaleInput(unread.join('\n'));
	const totality = checkTotality(table, flatPaths);
	const problems = [
		...totality.unmapped.map((path) => `unmapped: ${path}`),
		...totality.sharedDestinations.map(
			([to, from]) => `shared destination ${to}: ${from.join(', ')}`
		),
		...totality.splitSets
	];
	if (problems.length) {
		throw new StaleInput(`The move table does not map the checkout:\n${problems.join('\n')}`);
	}
	const edges = readImportEdges(checkout, flatPaths);
	const joined = joinRewrites(table, edges, checkout);
	const { rewrites, entries } = planExports(joined);
	return {
		checkout,
		inputs,
		source,
		table,
		flatPaths,
		rewrites,
		keptAliases: keepAliases(table, edges, joined, checkout),
		exportEntries: entries,
		aliasEntries: aliasImportEntries(table, edges, aliasMap(checkout)),
		aliases: new Map(aliasMap(checkout)),
		flatManifest,
		flatFile,
		manifests: new Map(),
		projectEdges: new Map(),
		written: new Set()
	};
}

export function readText(run: Run, path: string): string {
	return readFileSync(join(run.checkout, path), 'utf8');
}

export function writeText(run: Run, path: string, text: string): void {
	mkdirSync(dirname(join(run.checkout, path)), { recursive: true });
	writeFileSync(join(run.checkout, path), text);
	run.written.add(path);
}

export function treeFiles(run: Run): string[] {
	const moved = run.flatPaths.flatMap((path) => {
		const to = run.table.place(path)?.to;
		return to ? [to] : [];
	});
	return [...new Set([...moved, ...run.written])].sort(compareCodeUnits);
}

/** JSON as Prettier prints `package.json`: tabs, one key per line, a final newline. */
export function jsonText(value: unknown): string {
	return `${JSON.stringify(value, null, '\t')}\n`;
}
