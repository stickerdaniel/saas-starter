import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
	aliasMap,
	checkTotality,
	loadTable,
	plannedSpecifiers,
	readImportEdges,
	trackedPaths,
	type ImportEdge
} from '../../.agents/skills/upstream-sync/scripts/apply-layout.ts';
import {
	WORKSPACES,
	type MoveTable,
	type StarterWorkspace
} from '../../.agents/skills/upstream-sync/layout/v3.ts';

export class StaleInput extends Error {}

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
	readonly source: string;
	readonly table: MoveTable;
	readonly flatPaths: readonly string[];
	readonly rewrites: readonly Rewrite[];
	readonly keptAliases: readonly KeptAlias[];
	/** The alias prefixes of the flat tree with the directories they name. */
	readonly aliases: ReadonlyMap<string, string>;
	readonly flatManifest: Manifest;
	/** Reads a file of the flat tree as the source commit holds it. */
	readonly flatFile: (path: string) => string;
	/** The workspace manifests the steps build, keyed by workspace. */
	readonly manifests: Map<StarterWorkspace, Manifest>;
	/** Development dependencies on workspaces that the generated project files import. */
	readonly projectEdges: Map<StarterWorkspace, Set<StarterWorkspace>>;
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

export async function prepareRun(checkout: string, source: string): Promise<Run> {
	const { table, refusals } = await loadTable(checkout);
	if (refusals.length) throw new StaleInput(`The move table is refused:\n${refusals.join('\n')}`);
	const flatPaths = trackedPaths(checkout);
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
	const rewrites = joinRewrites(table, edges, checkout);
	const flatFile = (path: string): string => {
		const shown = spawnSync('git', ['show', `${source}:${path}`], {
			cwd: checkout,
			encoding: 'utf8',
			maxBuffer: 64 * 1024 * 1024
		});
		if (shown.status !== 0) throw new StaleInput(`${path} is no tracked file of ${source}`);
		return shown.stdout;
	};
	return {
		checkout,
		source,
		table,
		flatPaths,
		rewrites,
		keptAliases: keepAliases(table, edges, rewrites, checkout),
		aliases: new Map(aliasMap(checkout)),
		flatManifest: JSON.parse(flatFile('package.json')),
		flatFile,
		manifests: new Map(),
		projectEdges: new Map()
	};
}

export function readText(run: Run, path: string): string {
	return readFileSync(join(run.checkout, path), 'utf8');
}

export function writeText(run: Run, path: string, text: string): void {
	mkdirSync(dirname(join(run.checkout, path)), { recursive: true });
	writeFileSync(join(run.checkout, path), text);
}

/** JSON as Prettier prints `package.json`: tabs, one key per line, a final newline. */
export function jsonText(value: unknown): string {
	return `${JSON.stringify(value, null, '\t')}\n`;
}
