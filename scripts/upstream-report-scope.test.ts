import { existsSync, realpathSync, statSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import suiteConfig from '../.agents/skills/upstream-report/scripts/vitest.config';
import {
	UPSTREAM_REPORT_TEST_INPUTS,
	isUpstreamReportTestInput,
	selectUpstreamReportTests
} from './upstream-report-scope';

const ROOT = path.resolve(import.meta.dirname, '..');
const SUITE_CONFIG = '.agents/skills/upstream-report/scripts/vitest.config.ts';
const SELECTION = 'scripts/upstream-report-scope.ts';

const FS_MODULES = new Set(['fs', 'fs/promises', 'node:fs', 'node:fs/promises']);
// These create, change or remove a path, or use a descriptor from an open the scan already
// checked, so their argument is nothing the suite reads. Every other fs function is a read.
const FS_NON_READS = new Set([
	'appendFile',
	'chmod',
	'close',
	'fstat',
	'mkdir',
	'mkdtemp',
	'read',
	'rename',
	'rm',
	'symlink',
	'unlink',
	'utimes',
	'write',
	'writeFile'
]);
// These read a directory's entries, which only a directory input covers.
const FS_DIRECTORY_READS = new Set(['cp', 'glob', 'opendir', 'readdir', 'watch']);

/** An absolute path, or a relative one not yet joined to a base. */
type Value = { path: string } | { text: string };

const isText = (value: Value): value is { text: string } => 'text' in value;

interface Scan {
	/** Repository paths reached. A trailing slash marks a directory the file reads. */
	reached: string[];
	/** Module specifiers loaded from outside the checkout: built-ins and installed packages. */
	external: string[];
	/** Accesses the scan cannot resolve, each with its call site. */
	unresolved: string[];
	/** Unresolved accesses a `// scope: <reason>` comment accepts, each with its reason. */
	escapes: string[];
}

/** A relative path resolves against the working directory, and the suite runs from the root. */
const absolutePath = (value: Value) =>
	'path' in value ? value.path : path.resolve(ROOT, value.text);

const isDirectory = (target: string) => existsSync(target) && statSync(target).isDirectory();

/**
 * What a source file loads and reads from the checkout. Every import, `require`, `import()`,
 * `Bun.file`, `new URL(…, import.meta.url)` and fs call outside FS_NON_READS is an access,
 * and each resolves to paths or lands in `unresolved`; nothing the scan cannot evaluate is
 * skipped. So does any other use of `Bun`, `require`, `createRequire` or an fs import, such
 * as passing `readFileSync` on, because the call it leads to is out of sight. Path
 * expressions found anywhere else, such as a script handed to a child process, are reported
 * when they name a file. A child process reading the checkout stays invisible.
 *
 * Expressions evaluate to every path they can take, from literals, `import.meta`,
 * `process.cwd()`, `tmpdir()`, `join`, `resolve`, `dirname`, `mkdtempSync`,
 * `realpathSync` and `fileURLToPath`, and through a variable when each value it is ever
 * assigned evaluates. A parameter, a loop variable or a destructured name never does.
 *
 * An unresolved access that provably never touches the checkout may carry a
 * `// scope: <reason>` comment on the line before it, which moves it to `escapes`.
 */
function scan(file: string): Scan {
	const absolute = path.join(ROOT, file);
	const directory = path.dirname(absolute);
	// A program without libraries or imports binds the file's own names, which is all the
	// scan asks of it, so one name declared in two scopes stays two variables.
	const program = ts.createProgram([absolute], { noLib: true, noResolve: true, allowJs: true });
	const source = program.getSourceFile(absolute);
	if (!source) throw new Error(`${file} could not be parsed`);
	const checker = program.getTypeChecker();
	const lines = source.text.split(/\r?\n/);
	const reached = new Set<string>();
	const result: Scan = { reached: [], external: [], unresolved: [], escapes: [] };

	// Every value each variable is given; `undefined` stands for one the scan cannot follow.
	const assignments = new Map<ts.Symbol, Array<ts.Expression | undefined>>();
	const assign = (name: ts.Node, value?: ts.Expression) => {
		const symbol = checker.getSymbolAtLocation(name);
		if (symbol) assignments.set(symbol, [...(assignments.get(symbol) ?? []), value]);
	};
	const fsFunctions = new Map<ts.Symbol, string>();
	const fsNamespaces = new Set<ts.Symbol>();
	const addSymbol = (name: ts.Node, add: (symbol: ts.Symbol) => unknown) => {
		const symbol = checker.getSymbolAtLocation(name);
		if (symbol) add(symbol);
	};
	(function collect(node: ts.Node): void {
		if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
			const loop =
				ts.isForInStatement(node.parent.parent) || ts.isForOfStatement(node.parent.parent);
			if (loop || node.initializer) assign(node.name, loop ? undefined : node.initializer);
		} else if ((ts.isParameter(node) || ts.isBindingElement(node)) && ts.isIdentifier(node.name)) {
			assign(node.name);
		} else if (
			ts.isBinaryExpression(node) &&
			ts.isIdentifier(node.left) &&
			node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
			node.operatorToken.kind <= ts.SyntaxKind.LastAssignment
		) {
			const plain = node.operatorToken.kind === ts.SyntaxKind.EqualsToken;
			assign(node.left, plain ? node.right : undefined);
		} else if (
			ts.isImportDeclaration(node) &&
			ts.isStringLiteral(node.moduleSpecifier) &&
			FS_MODULES.has(node.moduleSpecifier.text)
		) {
			const clause = node.importClause;
			const bindings = clause?.namedBindings;
			if (clause?.name) addSymbol(clause.name, (symbol) => fsNamespaces.add(symbol));
			if (bindings && ts.isNamespaceImport(bindings)) {
				addSymbol(bindings.name, (symbol) => fsNamespaces.add(symbol));
			}
			for (const element of bindings && ts.isNamedImports(bindings) ? bindings.elements : []) {
				const imported = (element.propertyName ?? element.name).text;
				// Flag numbers for `open`, not a function.
				if (imported === 'constants') continue;
				addSymbol(element.name, (symbol) =>
					imported === 'promises' ? fsNamespaces.add(symbol) : fsFunctions.set(symbol, imported)
				);
			}
		}
		ts.forEachChild(node, collect);
	})(source);

	const isMeta = (node: ts.Node | undefined, property: string) =>
		node !== undefined &&
		ts.isPropertyAccessExpression(node) &&
		ts.isMetaProperty(node.expression) &&
		node.name.text === property;

	// `null` marks a variable being evaluated, so a cyclic assignment stays unresolved.
	const variables = new Map<ts.Symbol, Value[] | undefined | null>();
	function evaluateVariable(symbol: ts.Symbol): Value[] | undefined {
		if (variables.has(symbol)) return variables.get(symbol) ?? undefined;
		variables.set(symbol, null);
		const values: Value[] = [];
		for (const assigned of assignments.get(symbol) ?? [undefined]) {
			const next = assigned && evaluate(assigned);
			if (!next) {
				variables.set(symbol, undefined);
				return undefined;
			}
			values.push(...next);
		}
		const unique = [...new Map(values.map((value) => [JSON.stringify(value), value])).values()];
		variables.set(symbol, unique);
		return unique;
	}

	/** Every combination of the arguments' values, or `undefined` past what is worth listing. */
	function combinations(nodes: readonly ts.Expression[]): Value[][] | undefined {
		let combined: Value[][] = [[]];
		for (const node of nodes) {
			const values = evaluate(node);
			if (!values) return undefined;
			combined = combined.flatMap((prefix) => values.map((value) => [...prefix, value]));
			if (combined.length > 64) return undefined;
		}
		return combined;
	}

	function evaluate(node: ts.Expression): Value[] | undefined {
		if (ts.isStringLiteralLike(node)) return [{ text: node.text }];
		if (ts.isTemplateExpression(node)) {
			const spans = combinations(node.templateSpans.map((span) => span.expression));
			const values = spans?.map((parts): Value | undefined => {
				// Only a leading substitution may be an absolute path, as in `${marker}.swapped`.
				const leadingPath = node.head.text === '' && parts[0] !== undefined && !isText(parts[0]);
				if (!parts.every((part, index) => isText(part) || (leadingPath && index === 0))) {
					return undefined;
				}
				const text = parts.reduce(
					(joined, part, index) =>
						`${joined}${'path' in part ? part.path : part.text}${node.templateSpans[index]?.literal.text ?? ''}`,
					node.head.text
				);
				return leadingPath ? { path: text } : { text };
			});
			return values?.every((value) => value !== undefined) ? values : undefined;
		}
		if (
			ts.isParenthesizedExpression(node) ||
			ts.isAsExpression(node) ||
			ts.isSatisfiesExpression(node) ||
			ts.isNonNullExpression(node)
		) {
			return evaluate(node.expression);
		}
		if (isMeta(node, 'dirname')) return [{ path: directory }];
		if (isMeta(node, 'filename') || isMeta(node, 'url')) return [{ path: absolute }];
		if (ts.isIdentifier(node)) {
			const symbol = checker.getSymbolAtLocation(node);
			return symbol && evaluateVariable(symbol);
		}
		if (ts.isCallExpression(node)) {
			const callee = node.expression.getText(source).replace(/^(?:path|os)\./, '');
			if (callee === 'process.cwd') return [{ path: ROOT }];
			if (callee === 'tmpdir') return [{ path: tmpdir() }];
			if (!/^(?:join|resolve|dirname|mkdtempSync|realpathSync|fileURLToPath)$/.test(callee)) {
				return undefined;
			}
			const calls = node.arguments.length > 0 ? combinations(node.arguments) : undefined;
			return calls?.map(([first, ...rest]): Value => {
				const strings = [first, ...rest].map((arg) => ('path' in arg ? arg.path : arg.text));
				if (callee === 'resolve') return { path: path.resolve(ROOT, ...strings) };
				if (callee === 'join') {
					const joined = path.join(...strings);
					return 'path' in first ? { path: joined } : { text: joined };
				}
				if (callee === 'dirname') return { path: path.dirname(absolutePath(first)) };
				// A temp directory is created next to its prefix, and a real path is the same file.
				return { path: absolutePath(first) };
			});
		}
		if (
			ts.isNewExpression(node) &&
			node.expression.getText(source) === 'URL' &&
			isMeta(node.arguments?.[1], 'url')
		) {
			const [specifier] = node.arguments ?? [];
			const specifiers = specifier && evaluate(specifier);
			if (!specifiers?.every(isText)) return undefined;
			return specifiers.map((value) => ({ path: path.resolve(directory, value.text) }));
		}
		return undefined;
	}

	/** Adds a repository path to `reached`, and says whether `target` was one. */
	function record(target: string, directoryRead: boolean): boolean {
		const relative = path.relative(ROOT, target);
		// Outside the checkout, such as a temp directory a test creates.
		if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
			return false;
		}
		const parts = relative.split(path.sep);
		// Installed packages follow from the manifest and lockfile, which the scope lists.
		if (parts[0] === 'node_modules') return false;
		const name = parts.join('/');
		reached.add(directoryRead || isDirectory(target) ? `${name || '.'}/` : name);
		return true;
	}

	const moduleFile = (target: string) =>
		[
			target,
			...['.ts', '.js', '/index.ts', '/index.js'].map((suffix) => `${target}${suffix}`)
		].find((candidate) => existsSync(candidate) && statSync(candidate).isFile()) ?? target;

	/** The path a specifier loads, `null` for a built-in, or `undefined` when unknown. */
	function moduleTarget(specifier: string): string | null | undefined {
		if (specifier.startsWith('node:') || builtinModules.includes(specifier)) return null;
		if (specifier.startsWith('.') || path.isAbsolute(specifier)) {
			return moduleFile(path.resolve(directory, specifier));
		}
		// A `#` subpath import or an alias finds no installed package and stays unresolved.
		const name = specifier
			.split('/')
			.slice(0, specifier.startsWith('@') ? 2 : 1)
			.join('/');
		for (let from = directory; ; from = path.dirname(from)) {
			const installed = path.join(from, 'node_modules', name);
			// A workspace package links back into the checkout, which `record` then reports.
			if (existsSync(installed)) return realpathSync(installed);
			if (from === ROOT || from === path.dirname(from)) return undefined;
		}
	}

	const line = (node: ts.Node) => source.getLineAndCharacterOfPosition(node.getStart(source)).line;
	const site = (node: ts.Node) => `${file}:${line(node) + 1}`;
	const escape = (node: ts.Node) => /^\s*\/\/ scope: (.+)$/.exec(lines[line(node) - 1] ?? '')?.[1];

	function unresolved(node: ts.Node): void {
		const reason = escape(node);
		if (reason) result.escapes.push(`${site(node)}: ${reason}`);
		else result.unresolved.push(`${site(node)}: ${node.getText(source).split('\n')[0]}`);
	}

	function resolved(node: ts.Node): void {
		if (escape(node)) result.unresolved.push(`${site(node)}: resolves, so drop its scope comment`);
	}

	function access(node: ts.Node, target: ts.Expression | undefined, directoryRead: boolean) {
		const values = target && evaluate(target);
		if (!values) return unresolved(node);
		resolved(node);
		for (const value of values) record(absolutePath(value), directoryRead);
	}

	function load(node: ts.Node, specifier: string, isStatic: boolean): void {
		// Only a static import tells the scan which calls are fs calls.
		if (FS_MODULES.has(specifier) && !isStatic) return unresolved(node);
		const target = moduleTarget(specifier);
		if (target === undefined) return unresolved(node);
		resolved(node);
		if (target === null || !record(target, false)) result.external.push(specifier);
	}

	/** The fs function a call invokes, through a named import or a namespace. */
	function fsFunction(callee: ts.Expression): string | undefined {
		const target = ts.isPropertyAccessExpression(callee) ? callee.expression : callee;
		const symbol = checker.getSymbolAtLocation(target);
		if (!symbol) return undefined;
		if (target === callee) return fsFunctions.get(symbol);
		return fsNamespaces.has(symbol) && ts.isPropertyAccessExpression(callee)
			? callee.name.text
			: undefined;
	}

	/** Whether an identifier refers to an fs import, `Bun` or a module loader. */
	function isLoader(node: ts.Identifier): boolean {
		const symbol = checker.getSymbolAtLocation(node);
		if (symbol && (fsFunctions.has(symbol) || fsNamespaces.has(symbol))) return true;
		return ['Bun', 'require', 'createRequire'].includes(node.text);
	}

	// The identifiers the access branches below consume, so `visit` only reports the rest.
	const consumed = new Set<ts.Node>();

	function visit(node: ts.Node): void {
		// A type such as `Stats` never runs.
		if (ts.isTypeNode(node)) return;
		if (
			(ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
			node.moduleSpecifier &&
			ts.isStringLiteral(node.moduleSpecifier)
		) {
			load(node, node.moduleSpecifier.text, true);
			// The import declares these names; their uses are what the scan checks.
			return;
		}
		if (ts.isCallExpression(node)) {
			const callee = node.expression;
			const name = callee.getText(source);
			const [first] = node.arguments;
			const fs = fsFunction(callee);
			if (
				callee.kind === ts.SyntaxKind.ImportKeyword ||
				name === 'require' ||
				name === 'require.resolve'
			) {
				const values = first && evaluate(first);
				if (values?.every(isText)) {
					for (const value of values) load(node, value.text, false);
				} else {
					unresolved(node);
				}
			} else if (fs !== undefined) {
				const base = fs.replace(/Sync$/, '');
				if (!FS_NON_READS.has(base)) access(node, first, FS_DIRECTORY_READS.has(base));
			} else if (name === 'Bun.file') {
				access(node, first, false);
			}
			if (fs !== undefined || /^(?:require|require\.resolve|Bun\.file)$/.test(name)) {
				consumed.add(ts.isPropertyAccessExpression(callee) ? callee.expression : callee);
			}
		} else if (
			ts.isNewExpression(node) &&
			node.expression.getText(source) === 'URL' &&
			isMeta(node.arguments?.[1], 'url')
		) {
			access(node, node, false);
		} else if (
			ts.isIdentifier(node) &&
			!consumed.has(node) &&
			!(ts.isPropertyAccessExpression(node.parent) && node.parent.name === node) &&
			isLoader(node)
		) {
			// Passed on, aliased, or a member such as `Bun.Glob`: the read it leads to is out of sight.
			unresolved(node);
		}
		if (ts.isExpression(node)) {
			for (const value of evaluate(node) ?? []) {
				if ('path' in value && !isDirectory(value.path)) record(value.path, false);
			}
		}
		ts.forEachChild(node, visit);
	}

	visit(source);
	return { ...result, reached: [...reached] };
}

/** Every string in the suite's Vitest config that names a repository file, such as `tsconfig`. */
function configPaths(value: unknown): string[] {
	if (typeof value === 'string') {
		const target = path.resolve(ROOT, value);
		return existsSync(target) && statSync(target).isFile()
			? [path.relative(ROOT, target).split(path.sep).join('/')]
			: [];
	}
	if (Array.isArray(value)) return value.flatMap(configPaths);
	if (typeof value === 'object' && value !== null) return Object.values(value).flatMap(configPaths);
	return [];
}

describe('upstream report test inputs', () => {
	const include = suiteConfig.test?.include ?? [];
	const found = new Set([SUITE_CONFIG, SELECTION, ...include, ...configPaths(suiteConfig)]);
	const unresolved: string[] = [];
	const escapes: string[] = [];
	// A Set visits what is added while iterating, so this follows every reached source file
	// and covers an import the detector or the shared settings gain later.
	for (const file of found) {
		if (/\.[cm]?[jt]s$/.test(file) && existsSync(path.join(ROOT, file))) {
			const result = scan(file);
			for (const next of result.reached) found.add(next);
			unresolved.push(...result.unresolved);
			escapes.push(...result.escapes);
		}
	}
	const reached = [...found].sort();

	it('reads the suite as files the scan can open', () => {
		expect(include.length).toBeGreaterThan(0);
		for (const file of include) {
			expect(existsSync(path.join(ROOT, file)), `${file}: expand globs before scanning`).toBe(true);
		}
	});

	it('sees the configuration readers it exists to guard (scanner sanity check)', () => {
		expect(reached).toEqual(
			expect.arrayContaining([
				'package.json',
				'.github/workflows/static-checks.yml',
				'scripts/vitest-settings.ts',
				'tsconfig.tooling.json'
			])
		);
	});

	// Without it, Vite transforms each test with the nearest tsconfig.json, which extends the
	// root one and SvelteKit's generated config. No import or read names that file.
	it('pins its tsconfig so the scan sees it', () => {
		expect(suiteConfig.tsconfig).toBeDefined();
	});

	it('resolves every module and filesystem access the suite makes', () => {
		// Printed on every run, so each accepted escape stays in front of a reviewer.
		console.info(`Accepted scope escapes:\n${escapes.join('\n')}`);
		expect(
			unresolved,
			'make these resolvable, or mark one that never touches the checkout with `// scope: <reason>`'
		).toEqual([]);
	});

	it('covers every repository path the suite reaches', () => {
		expect(
			reached.filter((file) => !isUpstreamReportTestInput(file)),
			'add these to UPSTREAM_REPORT_TEST_INPUTS, or the job skips changes the suite depends on'
		).toEqual([]);
	});

	it('lists only inputs that exist', () => {
		for (const input of UPSTREAM_REPORT_TEST_INPUTS) {
			expect(existsSync(path.join(ROOT, input)), input).toBe(true);
		}
	});
});

describe('upstream report test selection', () => {
	it('loads Node built-ins only and reads no repository path, because the job runs it before installing', () => {
		const { reached, external, unresolved, escapes } = scan(SELECTION);
		expect(external.length).toBeGreaterThan(0);
		expect(external.filter((specifier) => !specifier.startsWith('node:'))).toEqual([]);
		expect({ reached, unresolved, escapes }).toEqual({ reached: [], unresolved: [], escapes: [] });
	});

	const entry = (filename: string, previous?: string) => ({
		sha: 'b'.repeat(40),
		filename,
		status: previous ? 'renamed' : 'modified',
		...(previous ? { previous_filename: previous } : {})
	});
	const pullRequest = (
		pages: unknown,
		changedFiles = String((pages as unknown[][]).flat().length)
	) =>
		selectUpstreamReportTests({
			eventName: 'pull_request',
			changedFiles,
			readPages: () => pages
		});

	it('skips a pull request that changes only documentation', () => {
		expect(pullRequest([[entry('README.md'), entry('docs/AGENTS.md')]]).run).toBe(false);
	});

	it.each([
		'.agents/skills/upstream-report/SKILL.md',
		'bun.lock',
		'.github/workflows/static-checks.yml'
	])('runs when a pull request changes %s', (file) => {
		expect(pullRequest([[entry('README.md')], [entry(file)]]).run).toBe(true);
	});

	it('runs when a rename moves an input out of scope', () => {
		const rename = entry(
			'docs/upstream-relevance.ts',
			'.agents/skills/upstream-report/scripts/upstream-relevance.ts'
		);
		expect(pullRequest([[rename]]).run).toBe(true);
	});

	it('runs when the file list is incomplete', () => {
		expect(pullRequest([[entry('README.md')]], '2').run).toBe(true);
	});

	// Each of these matches `changed_files` while hiding a path the pull request changes.
	it.each([
		['a rename without its source', [{ filename: 'docs/relocated.ts', status: 'renamed' }]],
		['a copy without its source', [{ filename: 'docs/copied.ts', status: 'copied' }]],
		['a repeated entry', [entry('README.md'), entry('README.md')]],
		['an undocumented status', [{ filename: 'README.md', status: 'moved' }]]
	])('runs on %s', (_label, files) => {
		expect(pullRequest([files])).toEqual({
			run: true,
			reason: 'the changed-file list is malformed.'
		});
	});

	it.each([
		[
			'an unreadable list',
			() => {
				throw new Error('HTTP 502');
			}
		],
		['a malformed list', () => [{ filename: 'README.md' }]],
		['an entry without a path', () => [[{ status: 'modified' }]]]
	])('runs on %s', (_label, readPages) => {
		expect(
			selectUpstreamReportTests({ eventName: 'pull_request', changedFiles: '1', readPages }).run
		).toBe(true);
	});

	it('runs when the event carries no changed-file count', () => {
		expect(pullRequest([[entry('README.md')]], '').run).toBe(true);
	});

	it.each(['push', 'workflow_dispatch', 'merge_group'])(
		'runs on %s whatever changed',
		(eventName) => {
			const readPages = vi.fn(() => [[entry('README.md')]]);
			expect(selectUpstreamReportTests({ eventName, changedFiles: '1', readPages }).run).toBe(true);
			expect(readPages).not.toHaveBeenCalled();
		}
	);

	it('runs on a docs-only pull request while CI_FULL_SUITE is set', () => {
		const readPages = () => [[entry('README.md')]];
		const select = (fullSuite: string) =>
			selectUpstreamReportTests({
				fullSuite,
				eventName: 'pull_request',
				changedFiles: '1',
				readPages
			}).run;
		expect(select('')).toBe(false);
		expect(select('true')).toBe(true);
	});
});
