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
	FLAT_PATHS_WRITTEN_ANEW,
	isAllowedEdge,
	PRODUCED_FILES,
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

export const compareCodeUnits = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

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
export const UPSTREAM_REPOSITORY = 'stickerdaniel/saas-starter';

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
	if (env[UPSTREAM_CONTEXT] === '1' || env.GITHUB_REPOSITORY === UPSTREAM_REPOSITORY) {
		return { ...loaded, totality: 'strict', knownEdges: 'starter' };
	}
	const skip = {
		skip: `${EXTENSION_FILE} is absent and neither ${UPSTREAM_CONTEXT}=1 nor GITHUB_REPOSITORY=${UPSTREAM_REPOSITORY} is set, so the starter's table and known edges do not apply`
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
	readonly literalOffset: number;
}

const SCANNED = /\.(?:[cm]?[jt]s|[jt]sx|svelte)$/;
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
	'.tsx',
	'.jsx',
	'.json',
	'/index.ts',
	'/index.tsx',
	'/index.js',
	'/index.jsx'
];
const RUNTIME_EXTENSION = /\.(?:[cm]?js|jsx)$/;
const TYPED_SOURCES = new Map([
	['.mjs', ['.mts']],
	['.cjs', ['.cts']],
	['.jsx', ['.tsx']]
]);

function resolveTracked(path: string, tracked: ReadonlySet<string>): string {
	if (tracked.has(path)) return path;
	const runtime = path.match(RUNTIME_EXTENSION)?.[0] ?? '';
	const base = path.slice(0, path.length - runtime.length);
	for (const suffix of TYPED_SOURCES.get(runtime) ?? CANDIDATE_SUFFIXES) {
		if (tracked.has(base + suffix)) return base + suffix;
	}
	return tracked.has(`${base}.d.ts`) ? `${base}.d.ts` : path;
}

export interface FileReference {
	readonly text: string;
	readonly line: number;
	readonly literalOffset: number;
	readonly kind: 'module' | 'path' | 'glob' | 'url' | 'style' | 'source';
	readonly typeOnly: boolean;
}

/** The `<script>` blocks of a Svelte component, each with the line it starts on. */
function scriptBlocks(
	path: string,
	text: string
): Array<{ code: string; firstLine: number; offset: number }> {
	if (!path.endsWith('.svelte')) return [{ code: text, firstLine: 0, offset: 0 }];
	return taggedBlocks('script', text);
}

function taggedBlocks(
	tag: 'script' | 'style',
	text: string
): Array<{ code: string; firstLine: number; offset: number }> {
	return [...text.matchAll(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'g'))].map(
		(match) => {
			const offset = match.index + match[0].indexOf('>') + 1;
			return {
				code: match[1]!,
				firstLine: text.slice(0, offset).split('\n').length - 1,
				offset
			};
		}
	);
}

const STYLESHEET = /\.css$/;
const STYLE_DIRECTIVE =
	/@(import|reference|plugin|config|source)\s+(not\s+)?(['"])([^'"]*)\3([^;]*)/g;
const SOURCE_FUNCTION = /\bsource\(\s*(['"])([^'"]*)\1\s*\)/g;

function styleReferences(text: string, firstLine: number, offset: number): FileReference[] {
	const code = text.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, ' '));
	const lineAt = (index: number) => firstLine + code.slice(0, index).split('\n').length;
	const found: FileReference[] = [];
	for (const match of code.matchAll(STYLE_DIRECTIVE)) {
		const [whole, directive, , quote, value, rest] = match;
		const literalAt = match.index + whole.indexOf(quote!);
		found.push({
			text: value!,
			line: lineAt(match.index),
			literalOffset: offset + literalAt,
			kind: directive === 'source' ? 'source' : 'style',
			typeOnly: false
		});
		if (directive !== 'import') continue;
		const restAt = match.index + whole.length - rest!.length;
		for (const source of rest!.matchAll(SOURCE_FUNCTION)) {
			found.push({
				text: source[2]!,
				line: lineAt(restAt + source.index),
				literalOffset: offset + restAt + source.index + source[0].indexOf(source[1]!),
				kind: 'source',
				typeOnly: false
			});
		}
	}
	return found;
}

const isImportMetaGlob = (node: ts.Expression, source: ts.SourceFile) =>
	node.getText(source) === 'import.meta.glob';

/**
 * What a file names by a literal: module specifiers, the files it reads by path from
 * `import.meta.dirname`, glob patterns, URLs on `import.meta.url` and the directives of its
 * stylesheets. Code inside string literals is no reference.
 */
export function fileReferences(path: string, text: string): FileReference[] {
	if (STYLESHEET.test(path)) return styleReferences(text, 0, 0);
	const found: FileReference[] = [];
	if (path.endsWith('.svelte')) {
		for (const { code, firstLine, offset } of taggedBlocks('style', text)) {
			found.push(...styleReferences(code, firstLine, offset));
		}
	}
	for (const { code, firstLine, offset } of scriptBlocks(path, text)) {
		const scriptKind = path.endsWith('.tsx')
			? ts.ScriptKind.TSX
			: path.endsWith('.jsx')
				? ts.ScriptKind.JSX
				: ts.ScriptKind.TS;
		const source = ts.createSourceFile(path, code, ts.ScriptTarget.Latest, false, scriptKind);
		const add = (
			node: ts.Node,
			literal: ts.Node,
			value: string,
			kind: FileReference['kind'],
			typeOnly = false
		) =>
			found.push({
				text: value,
				kind,
				typeOnly,
				line: firstLine + source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
				literalOffset: offset + literal.getStart(source)
			});
		const visit = (node: ts.Node): void => {
			if (
				(ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
				node.moduleSpecifier &&
				ts.isStringLiteral(node.moduleSpecifier)
			) {
				const typeOnly = ts.isImportDeclaration(node)
					? node.importClause?.phaseModifier === ts.SyntaxKind.TypeKeyword
					: node.isTypeOnly;
				add(node, node.moduleSpecifier, node.moduleSpecifier.text, 'module', typeOnly);
			} else if (
				ts.isImportTypeNode(node) &&
				ts.isLiteralTypeNode(node.argument) &&
				ts.isStringLiteral(node.argument.literal)
			) {
				add(node, node.argument.literal, node.argument.literal.text, 'module', true);
			} else if (ts.isCallExpression(node)) {
				const callee = node.expression.getText(source);
				const [first, ...rest] = node.arguments;
				if (
					(node.expression.kind === ts.SyntaxKind.ImportKeyword || MODULE_CALLS.has(callee)) &&
					first &&
					ts.isStringLiteralLike(first)
				) {
					add(node, first, first.text, 'module');
				} else if (
					PATH_CALLS.has(callee) &&
					first?.getText(source).replace(/!$/, '') === 'import.meta.dirname' &&
					rest.length > 0 &&
					rest.every(ts.isStringLiteralLike)
				) {
					add(node, first, posix.join(...rest.map((argument) => argument.text)), 'path');
				} else if (isImportMetaGlob(node.expression, source) && first) {
					const patterns = ts.isArrayLiteralExpression(first) ? first.elements : [first];
					for (const pattern of patterns) {
						if (ts.isStringLiteralLike(pattern)) add(node, pattern, pattern.text, 'glob');
					}
				}
			} else if (
				ts.isNewExpression(node) &&
				node.expression.getText(source) === 'URL' &&
				node.arguments?.length === 2 &&
				ts.isStringLiteralLike(node.arguments[0]!) &&
				node.arguments[1]!.getText(source) === 'import.meta.url'
			) {
				add(node, node.arguments[0]!, node.arguments[0]!.text, 'url');
			}
			ts.forEachChild(node, visit);
		};
		visit(source);
	}
	return found;
}

/** Every import and path read of the scanned tracked files under `checkout`. */
export function readImportEdges(checkout: string, paths: readonly string[]): ImportEdge[] {
	const tracked = new Set([...paths, ...PRODUCED_FILES.flatMap(({ outputs }) => outputs)]);
	const aliases = aliasMap(checkout);
	const edges: ImportEdge[] = [];
	for (const from of paths) {
		if (!SCANNED.test(from)) continue;
		const absolute = join(checkout, from);
		if (!existsSync(absolute) || !lstatSync(absolute).isFile()) continue;
		const directory = posix.dirname(from);
		for (const { text: specifier, line, literalOffset, kind } of fileReferences(
			from,
			readFileSync(absolute, 'utf8')
		)) {
			if (kind !== 'module' && kind !== 'path') continue;
			if (kind === 'path') {
				const target = posix.join(directory, specifier);
				if (tracked.has(target))
					edges.push({ from, line, literalOffset, specifier, target, kind: 'path-read' });
				continue;
			}
			if (KIT.test(specifier)) {
				edges.push({ from, line, literalOffset, specifier, target: specifier, kind: 'kit' });
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
			edges.push({
				from,
				line,
				literalOffset,
				specifier,
				target: resolveTracked(path, tracked),
				kind: 'import'
			});
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
	return [...pairs].sort(([a], [b]) => compareCodeUnits(a, b)).map(([, pair]) => pair);
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
	const to = placement?.to;
	if (!placement || !to) return undefined;
	const { rule } = placement;
	if (rule.to !== null && rule.from.endsWith('/') && resolved.startsWith(rule.from)) {
		return rule.to + resolved.slice(rule.from.length);
	}
	if (resolved === target) return to;
	const runtime = resolved.match(RUNTIME_EXTENSION)?.[0] ?? '';
	const named = resolved.slice(0, resolved.length - runtime.length);
	const omitted = target.slice(named.length);
	const dropped = [omitted, omitted.replace(/^\/index(?=\.)/, '')].find((suffix) =>
		to.endsWith(suffix)
	);
	return dropped === undefined ? to : to.slice(0, to.length - dropped.length) + runtime;
}

interface AliasEntry {
	readonly key: string;
	readonly root: string;
}

function servingEntry(prefix: string, path: string, next: string): AliasEntry | undefined {
	const named = path.slice(prefix.length).split('/');
	const placed = next.split('/');
	let shared = 0;
	while (
		shared < Math.min(named.length, placed.length) &&
		named.at(-1 - shared) === placed.at(-1 - shared)
	) {
		shared += 1;
	}
	if (shared === 0) return undefined;
	const directory = (parts: readonly string[]) =>
		parts
			.slice(0, parts.length - shared)
			.map((part) => `${part}/`)
			.join('');
	return { key: prefix + directory(named), root: directory(placed) };
}

interface AliasImport {
	readonly owner: string;
	readonly prefix: string | undefined;
	readonly path: string;
	readonly next: string;
}

/**
 * The one prefix entry each workspace's imports map keeps per alias after the move: the entry most
 * of the workspace's own imports through that alias agree on, and the shortest one among equals.
 */
function aliasEntries(imports: readonly AliasImport[]): Map<string, AliasEntry> {
	const votes = new Map<string, Map<string, { entry: AliasEntry; count: number }>>();
	for (const { owner, prefix, path, next } of imports) {
		const entry = prefix === undefined ? undefined : servingEntry(prefix, path, next);
		if (!entry) continue;
		const group = `${owner}\t${prefix}`;
		const candidates = votes.get(group) ?? new Map<string, { entry: AliasEntry; count: number }>();
		votes.set(group, candidates);
		const candidate = `${entry.key}\t${entry.root}`;
		candidates.set(candidate, { entry, count: (candidates.get(candidate)?.count ?? 0) + 1 });
	}
	return new Map(
		[...votes].map(([group, candidates]) => [
			group,
			[...candidates.values()].sort(
				(a, b) =>
					b.count - a.count ||
					a.entry.key.length - b.entry.key.length ||
					compareCodeUnits(a.entry.root, b.entry.root) ||
					compareCodeUnits(a.entry.key, b.entry.key)
			)[0]!.entry
		])
	);
}

function specifierMoves(
	table: MoveTable,
	edges: readonly ImportEdge[],
	aliases: ReadonlyArray<readonly [string, string]>
) {
	return edges.flatMap((edge) => {
		if (edge.kind !== 'import' || edge.target.startsWith('node_modules/')) return [];
		const from = table.place(edge.from);
		const to = table.place(edge.target);
		if (!from?.to || !to) return [];
		const [path = '', query = ''] = edge.specifier.split(/(?=\?)/);
		const alias = aliases.find(([prefix]) => path.startsWith(prefix));
		const resolved = alias
			? alias[1] + path.slice(alias[0].length)
			: posix.join(posix.dirname(edge.from), path);
		const next = placeResolved(table, resolved, edge.target);
		if (next === undefined) return [];
		const physical = from.owner === 'root';
		const target =
			!physical && from.owner !== to.owner && isStarterWorkspace(to.owner)
				? WORKSPACES[to.owner]
				: undefined;
		const exported =
			target === undefined || target.name === null || !to.to
				? undefined
				: `${target.name}/${to.to.slice(target.root.length + target.exports.length)}`;
		return [
			{
				file: from.to,
				owner: from.owner,
				specifier: edge.specifier,
				path,
				query,
				next,
				exported,
				aliased: alias !== undefined,
				prefix: from.owner === to.owner && !physical ? alias?.[0] : undefined
			}
		];
	});
}

export interface AliasImportEntry {
	readonly owner: string;
	readonly prefix: string;
	readonly key: string;
	readonly root: string;
}

export function aliasImportEntries(
	table: MoveTable,
	edges: readonly ImportEdge[],
	aliases: ReadonlyArray<readonly [string, string]>
): AliasImportEntry[] {
	return [...aliasEntries(specifierMoves(table, edges, aliases))]
		.map(([group, entry]) => {
			const [owner = '', prefix = ''] = group.split('\t');
			return { owner, prefix, ...entry };
		})
		.sort((a, b) => compareCodeUnits(a.owner, b.owner) || compareCodeUnits(a.prefix, b.prefix));
}

/**
 * The import specifiers the move breaks, with their replacements. Inside one workspace a relative
 * specifier gets the relative path between the new places. An alias stays while the one prefix
 * entry its workspace keeps for it still reaches the target, and gets the relative path otherwise.
 * An imports map reaches no other workspace, so an alias into one never stays.
 * Across workspaces a specifier becomes the package name and the target's path below the package's
 * exported directory, with the file's own name and extension. A root file runs before any install,
 * so it gets a relative path to every target.
 */
export function plannedSpecifiers(
	table: MoveTable,
	edges: readonly ImportEdge[],
	aliases: ReadonlyArray<readonly [string, string]>
): SpecifierChange[] {
	const moves = specifierMoves(table, edges, aliases);
	const entries = aliasEntries(moves);
	return moves.flatMap(
		({ file, owner, specifier, path, query, next, exported, aliased, prefix }) => {
			if (exported !== undefined) return [{ file, specifier, next: `${exported}${query}` }];
			const entry = prefix === undefined ? undefined : entries.get(`${owner}\t${prefix}`);
			const kept = aliased
				? entry !== undefined &&
					path.startsWith(entry.key) &&
					entry.root + path.slice(entry.key.length) === next
				: posix.join(posix.dirname(file), path) === next;
			if (kept) return [];
			const relative = posix.relative(posix.dirname(file), next);
			return [
				{ file, specifier, next: `${relative.startsWith('.') ? '' : './'}${relative}${query}` }
			];
		}
	);
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
		return to !== undefined && to !== path && !FLAT_PATHS_WRITTEN_ANEW.includes(path);
	});
	for (const path of stragglers) console.log(path);
	process.exit(stragglers.length ? 1 : 0);
}

if (import.meta.main) await main();
