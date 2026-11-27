#!/usr/bin/env bun
/**
 * apply-layout.ts: apply the version 3 move table to this checkout's tracked paths and
 * import specifiers. It reports and plans; it moves no file.
 *
 *   --check        every tracked path lands on exactly one destination; exits 1 otherwise
 *   --renames      `<from>\t<to>` for each path that moves, `<from>\t-` for each one deleted
 *   --specifiers   `<file>\t<specifier>\t<new specifier>` for each import the move breaks
 *   --stragglers   tracked paths that still sit where the table moves them away from
 *   --edges        `<from>\t<to>` for each pair the dependency rule forbids under the table;
 *                  exits 1 when the table does not map the checkout
 *
 * The table is `layout/v3.ts` plus the product's `.upstream-sync.layout.ts`, whose default
 * export is `{ rules: MoveRule[], knownEdges?: [from, to][] }` for the product's own roots and
 * the forbidden pairs it keeps until its move.
 *
 * Usage:
 *   bun .agents/skills/upstream-sync/scripts/apply-layout.ts --check
 */
import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync } from 'node:fs';
import { join, posix } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import ts from 'typescript';
import {
	BASE_RULES,
	createMoveTable,
	EFFECT_LEAF_SET,
	isAllowedEdge,
	isStarterWorkspace,
	ruleProblem,
	WORKSPACES,
	type EdgePair,
	type LayoutExtension,
	type MoveRule,
	type MoveTable,
	type StarterWorkspace
} from '../layout/v3';

export const EXTENSION_FILE = '.upstream-sync.layout.ts';

function overlaps(a: string, b: string): boolean {
	return a === b || (a.endsWith('/') && b.startsWith(a)) || (b.endsWith('/') && a.startsWith(b));
}

/** Why each rule of a product's extension cannot join the base table. */
export function extensionRefusals(extension: readonly MoveRule[]): string[] {
	return extension.flatMap((rule, index) => {
		const collision = [...BASE_RULES, ...extension.slice(0, index)].find((other) =>
			overlaps(other.from, rule.from)
		);
		const problem = collision
			? `${rule.from} collides with the rule for ${collision.from}`
			: ruleProblem(rule);
		return problem ? [problem] : [];
	});
}

function isMoveRule(value: unknown): value is MoveRule {
	if (typeof value !== 'object' || value === null) return false;
	const { from, to, owner } = value as Record<string, unknown>;
	return (
		typeof from === 'string' && (typeof to === 'string' || to === null) && typeof owner === 'string'
	);
}

function isEdgePair(value: unknown): value is EdgePair {
	return (
		Array.isArray(value) && value.length === 2 && value.every((end) => typeof end === 'string')
	);
}

function isLayoutExtension(value: unknown): value is LayoutExtension {
	const { rules, knownEdges } = (value ?? {}) as { rules?: unknown; knownEdges?: unknown };
	return (
		Array.isArray(rules) &&
		rules.every(isMoveRule) &&
		(knownEdges === undefined || (Array.isArray(knownEdges) && knownEdges.every(isEdgePair)))
	);
}

export interface LoadedTable {
	readonly table: MoveTable;
	readonly refusals: readonly string[];
	readonly extension: Partial<LayoutExtension> | undefined;
}

/** The base table joined with the product's rules in `checkout`, or the reasons it refuses them. */
export async function loadTable(checkout: string): Promise<LoadedTable> {
	const path = join(checkout, EXTENSION_FILE);
	if (!existsSync(path)) {
		return { table: createMoveTable(BASE_RULES), refusals: [], extension: undefined };
	}
	const extension: unknown = (await import(pathToFileURL(path).href)).default;
	if (!isLayoutExtension(extension)) {
		return {
			table: createMoveTable(BASE_RULES),
			refusals: [
				`${EXTENSION_FILE} must export default { rules: { from, to, owner }[], knownEdges?: [from, to][] }`
			],
			extension: {}
		};
	}
	const refusals = extensionRefusals(extension.rules);
	return {
		table: createMoveTable(refusals.length ? BASE_RULES : [...BASE_RULES, ...extension.rules]),
		refusals,
		extension
	};
}

export const UPSTREAM_CONTEXT = 'SAAS_STARTER_UPSTREAM';

export interface Skip {
	readonly skip: string;
}

export interface Ratchet extends LoadedTable {
	readonly totality: 'strict' | Skip;
	readonly knownEdges: readonly EdgePair[] | 'starter' | Skip;
}

export async function selectRatchet(
	checkout: string,
	env: NodeJS.ProcessEnv = process.env
): Promise<Ratchet> {
	const loaded = await loadTable(checkout);
	if (loaded.extension) {
		return {
			...loaded,
			totality: 'strict',
			knownEdges:
				loaded.extension.knownEdges ??
				(loaded.refusals.length
					? []
					: {
							skip: `${EXTENSION_FILE} has no knownEdges; list them with bun .agents/skills/upstream-sync/scripts/apply-layout.ts --edges`
						})
		};
	}
	if (env[UPSTREAM_CONTEXT] === '1') {
		return { ...loaded, totality: 'strict', knownEdges: 'starter' };
	}
	const skip = {
		skip: `${UPSTREAM_CONTEXT} is not 1 and ${EXTENSION_FILE} is absent, so the starter's table and known edges do not apply`
	};
	return { ...loaded, totality: skip, knownEdges: skip };
}

export interface TotalityReport {
	readonly unmapped: readonly string[];
	readonly sharedDestinations: ReadonlyArray<readonly [string, readonly string[]]>;
	readonly splitSets: readonly string[];
}

function testSubject(path: string): string | undefined {
	const subject = path.replace(/\.test(\.[^/.]+)$/, '$1');
	return subject === path ? undefined : subject;
}

/**
 * Totality of `table` over `paths`: each path lands on exactly one destination, no two paths
 * share one, a test lands beside its subject, and the Effect leaf set stays one directory of one
 * owner.
 */
export function checkTotality(table: MoveTable, paths: readonly string[]): TotalityReport {
	const unmapped: string[] = [];
	const sources = new Map<string, string[]>();
	const homes = new Map<string, string>();
	for (const path of paths) {
		const placement = table.place(path);
		if (!placement) {
			unmapped.push(path);
		} else if (placement.to !== null) {
			sources.set(placement.to, [...(sources.get(placement.to) ?? []), path]);
			homes.set(path, `${placement.owner} ${posix.dirname(placement.to)}`);
		}
	}
	const splitSets: string[] = [];
	for (const path of paths) {
		const subject = testSubject(path);
		if (subject && homes.has(subject) && homes.get(subject) !== homes.get(path)) {
			splitSets.push(`${path} lands apart from ${subject}`);
		}
	}
	const leafHomes = new Set(EFFECT_LEAF_SET.flatMap((path) => homes.get(path) ?? []));
	if (leafHomes.size > 1) {
		splitSets.push(
			`The Effect leaf set lands in ${leafHomes.size} places: ${[...leafHomes].join(', ')}`
		);
	}
	const sharedDestinations = [...sources].filter(([, from]) => from.length > 1);
	return { unmapped, sharedDestinations, splitSets };
}

export function trackedPaths(checkout: string): string[] {
	const result = spawnSync('git', ['ls-files', '-z'], { cwd: checkout, encoding: 'utf-8' });
	if (result.status !== 0) throw new Error(`git ls-files failed in ${checkout}: ${result.stderr}`);
	return result.stdout.split('\0').filter(Boolean);
}

export interface ImportEdge {
	readonly from: string;
	readonly line: number;
	readonly specifier: string;
	/** The tracked file the specifier resolves to, or the bare path when no tracked file matches. */
	readonly target: string;
	readonly kind: 'import' | 'kit' | 'path-read';
}

const SCANNED = /\.(?:[cm]?[jt]s|svelte)$/;
const KIT = /^(?:\$app\/|\$env\/|\$service-worker$|@sveltejs\/kit(?:\/|$))/;
const MODULE_CALLS = new Set([
	'require',
	'vi.mock',
	'vi.doMock',
	'vi.unmock',
	'vi.importActual',
	'vi.importMock'
]);
const PATH_CALLS = new Set(['join', 'resolve', 'path.join', 'path.resolve']);

export function aliasMap(checkout: string): Array<[string, string]> {
	const manifest: { imports?: Record<string, string> } = JSON.parse(
		readFileSync(join(checkout, 'package.json'), 'utf8')
	);
	const aliases: Array<[string, string]> = [['$lib/', 'src/lib/']];
	for (const [key, value] of Object.entries(manifest.imports ?? {})) {
		if (key.endsWith('/*') && value.endsWith('/*')) {
			aliases.push([key.slice(0, -1), posix.normalize(value.slice(0, -1))]);
		}
	}
	return aliases;
}

const CANDIDATE_SUFFIXES = [
	'',
	'.ts',
	'.svelte.ts',
	'.js',
	'.svelte',
	'.json',
	'/index.ts',
	'/index.js'
];

function resolveTracked(path: string, tracked: ReadonlySet<string>): string {
	if (tracked.has(path)) return path;
	const base = path.replace(/\.[cm]?js$/, '');
	for (const suffix of CANDIDATE_SUFFIXES) if (tracked.has(base + suffix)) return base + suffix;
	return path;
}

interface Reference {
	readonly text: string;
	readonly line: number;
	readonly kind: 'module' | 'path';
}

/** The `<script>` blocks of a Svelte component, each with the line it starts on. */
function scriptBlocks(path: string, text: string): Array<{ code: string; firstLine: number }> {
	if (!path.endsWith('.svelte')) return [{ code: text, firstLine: 0 }];
	return [...text.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map((match) => ({
		code: match[1]!,
		firstLine: text.slice(0, match.index + match[0].indexOf('>') + 1).split('\n').length - 1
	}));
}

/**
 * The module specifiers a file names, and the files it reads by path from
 * `import.meta.dirname` with string literals alone. Code inside string literals is no reference.
 */
function references(path: string, text: string): Reference[] {
	const found: Reference[] = [];
	for (const { code, firstLine } of scriptBlocks(path, text)) {
		const source = ts.createSourceFile(path, code, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS);
		const add = (node: ts.Node, value: string, kind: Reference['kind']) =>
			found.push({
				text: value,
				kind,
				line: firstLine + source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1
			});
		const visit = (node: ts.Node): void => {
			if (
				(ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
				node.moduleSpecifier &&
				ts.isStringLiteral(node.moduleSpecifier)
			) {
				add(node, node.moduleSpecifier.text, 'module');
			} else if (
				ts.isImportTypeNode(node) &&
				ts.isLiteralTypeNode(node.argument) &&
				ts.isStringLiteral(node.argument.literal)
			) {
				add(node, node.argument.literal.text, 'module');
			} else if (ts.isCallExpression(node)) {
				const callee = node.expression.getText(source);
				const [first, ...rest] = node.arguments;
				if (
					(node.expression.kind === ts.SyntaxKind.ImportKeyword || MODULE_CALLS.has(callee)) &&
					first &&
					ts.isStringLiteralLike(first)
				) {
					add(node, first.text, 'module');
				} else if (
					PATH_CALLS.has(callee) &&
					first?.getText(source).replace(/!$/, '') === 'import.meta.dirname' &&
					rest.length > 0 &&
					rest.every(ts.isStringLiteralLike)
				) {
					add(node, posix.join(...rest.map((argument) => argument.text)), 'path');
				}
			}
			ts.forEachChild(node, visit);
		};
		visit(source);
	}
	return found;
}

/** Every import and path read of the scanned tracked files under `checkout`. */
export function readImportEdges(checkout: string, paths: readonly string[]): ImportEdge[] {
	const tracked = new Set(paths);
	const aliases = aliasMap(checkout);
	const edges: ImportEdge[] = [];
	for (const from of paths) {
		if (!SCANNED.test(from)) continue;
		const absolute = join(checkout, from);
		if (!existsSync(absolute) || !lstatSync(absolute).isFile()) continue;
		const directory = posix.dirname(from);
		for (const { text: specifier, line, kind } of references(
			from,
			readFileSync(absolute, 'utf8')
		)) {
			if (kind === 'path') {
				const target = posix.join(directory, specifier);
				if (tracked.has(target)) edges.push({ from, line, specifier, target, kind: 'path-read' });
				continue;
			}
			if (KIT.test(specifier)) {
				edges.push({ from, line, specifier, target: specifier, kind: 'kit' });
				continue;
			}
			const bare = specifier.split('?')[0]!;
			const alias = aliases.find(([prefix]) => bare.startsWith(prefix));
			const path = alias
				? alias[1] + bare.slice(alias[0].length)
				: bare.startsWith('.')
					? posix.join(directory, bare)
					: undefined;
			if (path === undefined || path.startsWith('../')) continue;
			edges.push({ from, line, specifier, target: resolveTracked(path, tracked), kind: 'import' });
		}
	}
	return edges;
}

function installOwner(path: string): StarterWorkspace | undefined {
	return (Object.keys(WORKSPACES) as StarterWorkspace[]).find((workspace) =>
		path.startsWith(`${WORKSPACES[workspace].root}node_modules/`)
	);
}

/**
 * The edges the dependency rule forbids under `table`. Kit belongs to the app. A relative path
 * into `node_modules` must still reach its own workspace's install after the move. An edge to a
 * path no rule covers is forbidden, and a product's own workspaces are free.
 */
export function forbiddenEdges(table: MoveTable, edges: readonly ImportEdge[]): ImportEdge[] {
	return edges.filter((edge) => {
		const from = table.place(edge.from);
		if (!from || !isStarterWorkspace(from.owner)) return false;
		if (edge.target.startsWith('node_modules/')) {
			if (from.to === null) return false;
			const landing = posix.join(posix.dirname(from.to), edge.specifier.split('?')[0]!);
			return installOwner(landing) !== from.owner;
		}
		const to = edge.kind === 'kit' ? 'web' : table.place(edge.target)?.owner;
		if (to === undefined) return true;
		return isStarterWorkspace(to) && !isAllowedEdge(from.owner, to);
	});
}

const pairText = ([from, to]: EdgePair) => `${from} -> ${to}`;

export function forbiddenPairs(table: MoveTable, edges: readonly ImportEdge[]): EdgePair[] {
	const pairs = new Map<string, EdgePair>(
		forbiddenEdges(table, edges).map(({ from, target }) => [
			pairText([from, target]),
			[from, target]
		])
	);
	return [...pairs].sort(([a], [b]) => a.localeCompare(b)).map(([, pair]) => pair);
}

export function compareEdges(
	found: readonly EdgePair[],
	known: readonly EdgePair[]
): { added: string[]; gone: string[] } {
	const foundText = new Set(found.map(pairText));
	const knownText = new Set(known.map(pairText));
	return {
		added: [...foundText].filter((pair) => !knownText.has(pair)),
		gone: [...knownText].filter((pair) => !foundText.has(pair))
	};
}

export interface SpecifierChange {
	readonly file: string;
	readonly specifier: string;
	readonly next: string;
}

function placeResolved(table: MoveTable, resolved: string, target: string): string | undefined {
	const placement = table.place(target);
	if (!placement?.to) return undefined;
	const { rule } = placement;
	if (rule.to !== null && rule.from.endsWith('/') && resolved.startsWith(rule.from)) {
		return rule.to + resolved.slice(rule.from.length);
	}
	return posix.join(posix.dirname(placement.to), posix.basename(resolved));
}

/**
 * The import specifiers the move breaks, with their replacements. Inside one workspace a relative
 * specifier gets the relative path between the new places, and an alias stays for the workspace's
 * own imports map. Across workspaces a specifier becomes the package name and the path below the
 * package's exported directory. A root file runs before any install, so it gets a relative path
 * to every target.
 */
export function plannedSpecifiers(
	table: MoveTable,
	edges: readonly ImportEdge[],
	aliases: ReadonlyArray<readonly [string, string]>
): SpecifierChange[] {
	const changes: SpecifierChange[] = [];
	for (const edge of edges) {
		if (edge.kind !== 'import' || edge.target.startsWith('node_modules/')) continue;
		const from = table.place(edge.from);
		const to = table.place(edge.target);
		if (!from?.to || !to) continue;
		const [path = '', query = ''] = edge.specifier.split(/(?=\?)/);
		const alias = aliases.find(([prefix]) => path.startsWith(prefix));
		const resolved = alias
			? alias[1] + path.slice(alias[0].length)
			: posix.join(posix.dirname(edge.from), path);
		const next = placeResolved(table, resolved, edge.target);
		if (next === undefined) continue;
		const physical = from.owner === 'root';
		if (
			!physical &&
			from.owner !== to.owner &&
			isStarterWorkspace(to.owner) &&
			WORKSPACES[to.owner].name !== null
		) {
			const { name, root, exports } = WORKSPACES[to.owner];
			changes.push({
				file: from.to,
				specifier: edge.specifier,
				next: `${name}/${next.slice(root.length + exports.length)}${query}`
			});
			continue;
		}
		if ((alias && !physical) || posix.join(posix.dirname(from.to), path) === next) continue;
		const relative = posix.relative(posix.dirname(from.to), next);
		changes.push({
			file: from.to,
			specifier: edge.specifier,
			next: `${relative.startsWith('.') ? '' : './'}${relative}${query}`
		});
	}
	return changes;
}

async function main() {
	const { values } = parseArgs({
		args: process.argv.slice(2),
		options: {
			check: { type: 'boolean', default: false },
			renames: { type: 'boolean', default: false },
			specifiers: { type: 'boolean', default: false },
			stragglers: { type: 'boolean', default: false },
			edges: { type: 'boolean', default: false }
		},
		strict: true
	});
	const modes = Object.entries(values).filter(([, on]) => on);
	if (modes.length !== 1) {
		console.error('Pass exactly one of --check, --renames, --specifiers, --stragglers, --edges.');
		process.exit(2);
	}
	const checkout = spawnSync('git', ['rev-parse', '--show-toplevel'], {
		encoding: 'utf-8'
	}).stdout.trim();
	const { table, refusals } = await loadTable(checkout);
	if (refusals.length) {
		console.error(`${EXTENSION_FILE} is refused:`);
		for (const refusal of refusals) console.error(`  ${refusal}`);
		process.exit(1);
	}
	const paths = trackedPaths(checkout);

	if (values.check || values.edges) {
		const report = checkTotality(table, paths);
		const log = values.check ? console.log : console.error;
		log(`${paths.length} tracked paths, ${report.unmapped.length} unmapped paths`);
		for (const path of report.unmapped) log(`  unmapped: ${path}`);
		for (const [to, from] of report.sharedDestinations)
			log(`  shared destination ${to}: ${from.join(', ')}`);
		for (const line of report.splitSets) log(`  ${line}`);
		if (values.edges) {
			for (const [from, to] of forbiddenPairs(table, readImportEdges(checkout, paths))) {
				console.log(`${from}\t${to}`);
			}
		}
		const failures =
			report.unmapped.length + report.sharedDestinations.length + report.splitSets.length;
		process.exit(failures ? 1 : 0);
	}
	if (values.renames) {
		for (const path of paths) {
			const to = table.place(path)?.to;
			if (to !== path && to !== undefined) console.log(`${path}\t${to ?? '-'}`);
		}
		return;
	}
	if (values.specifiers) {
		for (const change of plannedSpecifiers(
			table,
			readImportEdges(checkout, paths),
			aliasMap(checkout)
		)) {
			console.log(`${change.file}\t${change.specifier}\t${change.next}`);
		}
		return;
	}
	const stragglers = paths.filter((path) => {
		const to = table.place(path)?.to;
		return to !== undefined && to !== path;
	});
	for (const path of stragglers) console.log(path);
	process.exit(stragglers.length ? 1 : 0);
}

if (import.meta.main) await main();
