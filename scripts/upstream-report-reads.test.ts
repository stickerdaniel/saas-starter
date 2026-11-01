import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { isUpstreamReportTestInput } from './upstream-report-scope';

// The upstream report suite runs in a checkout of only its declared inputs, so a read that
// fails without its file fails there. A read that tolerates the missing file, such as
// `existsSync`, an optional read, a glob or a directory listing, passes in that checkout and
// differs in a full one, so the suite could be skipped on a pull request that changes what it
// reads. This guard runs in Unit Tests, on the full checkout, and traces every path the suite
// builds from the repository root to a declared input.

const ROOT = path.resolve(import.meta.dirname, '..');
const SUITE = '.agents/skills/upstream-report/scripts';

interface Allowed {
	file: string;
	/** Functions, or test titles, containing the accesses. */
	scopes: readonly string[];
	reason: string;
}

/**
 * Root-derived accesses the analysis cannot prove covered. Every entry says why those
 * accesses read nothing of this checkout while the suite runs, and a scope that matches
 * nothing fails the guard.
 */
const ALLOWED: readonly Allowed[] = [
	{
		file: `${SUITE}/upstream-relevance.ts`,
		scopes: [
			'gitBytes',
			'gitPartialBytes',
			'gitUnpinned',
			'historyGitBytes',
			'readBatch',
			'capturedDiff'
		],
		reason:
			'The detector runs Git where main() moved it, the repository being reported on. ' +
			'The suite runs main() only as a child process inside the fixture repositories it ' +
			'creates, and importing the file or calling its exports starts no process.'
	},
	{
		file: `${SUITE}/upstream-relevance.integration.test.ts`,
		scopes: ['reftableSupported'],
		reason: '`git init --bare` of a temporary path, which reads no repository.'
	},
	{
		file: `${SUITE}/upstream-relevance.integration.test.ts`,
		scopes: ['realGitPath'],
		reason: '`command -v git` locates the executable and reads no repository.'
	}
];

/** A path value as far as the source text determines it. */
type Value =
	/** Built from the repository root; `path` is undefined when a segment is not a literal. */
	| { kind: 'repository'; path: string | undefined; fileUrl?: boolean }
	| { kind: 'text'; text: string }
	| { kind: 'other' };

interface Finding {
	file: string;
	line: number;
	scope: string;
	problem: string;
}

const OTHER: Value = { kind: 'other' };
const UNRESOLVED: Value = { kind: 'repository', path: undefined };
// Alternatives past this many collapse; a helper called with many temporary paths stays one.
const MAX_ALTERNATIVES = 32;
const TWO_PATH_FS = new Set(
	['copyFile', 'cp', 'rename', 'link', 'symlink'].flatMap((name) => [name, `${name}Sync`])
);
const SPAWNS = new Set([
	'spawn',
	'spawnSync',
	'execFile',
	'execFileSync',
	'fork',
	'exec',
	'execSync'
]);
const SOURCE = /\.(?:[cm]?ts|tsx)$/;

const covered = (file: string) =>
	isUpstreamReportTestInput(file) || isUpstreamReportTestInput(`${file}/`);

/** A repository path for `file`, or `other` once it leaves the repository. */
function repository(file: string, fileUrl?: boolean): Value {
	const normalized = path.posix.normalize(file.replace(/^\/+/, '')).replace(/\/+$/, '');
	if (normalized === '..' || normalized.startsWith('../')) return OTHER;
	return { kind: 'repository', path: normalized === '.' ? '' : normalized, fileUrl };
}

const isAbsolute = (text: string) => text.startsWith('/') || /^[A-Za-z]:[\\/]/.test(text);

/** A path the working directory resolves, the repository root under Vitest, as rooted there. */
const fromWorkingDirectory = (value: Value): Value =>
	value.kind === 'text' && value.text !== '' && !isAbsolute(value.text)
		? repository(value.text)
		: value;

function distinct(values: Value[]): Value[] {
	const unique = [...new Map(values.map((value) => [JSON.stringify(value), value])).values()];
	if (unique.length <= MAX_ALTERNATIVES) return unique;
	return [unique.some((value) => value.kind === 'repository') ? UNRESOLVED : OTHER];
}

/** Every combination of the alternatives of each part, folded left to right. */
function combine(parts: Value[][], fold: (left: Value, right: Value) => Value): Value[] {
	let results: Value[] = parts[0] ?? [OTHER];
	for (const part of parts.slice(1)) {
		results = distinct(results.flatMap((left) => part.map((right) => fold(left, right))));
	}
	return results;
}

function concat(left: Value, right: Value): Value {
	if (left.kind === 'text' && right.kind === 'text')
		return { kind: 'text', text: left.text + right.text };
	if (left.kind === 'repository' && right.kind === 'text') {
		if (right.text === '') return left;
		if (left.path === undefined || !/^[\\/]/.test(right.text)) return UNRESOLVED;
		return repository(`${left.path}${right.text}`);
	}
	if (left.kind === 'text' && left.text === '' && right.kind === 'repository') return right;
	return left.kind === 'repository' || right.kind === 'repository' ? UNRESOLVED : OTHER;
}

function join(left: Value, right: Value): Value {
	if (left.kind === 'text' && right.kind === 'text') {
		return { kind: 'text', text: path.posix.join(left.text, right.text) };
	}
	if (left.kind === 'repository' && right.kind === 'text') {
		return left.path === undefined
			? UNRESOLVED
			: repository(path.posix.join(left.path, right.text));
	}
	return left.kind === 'repository' || right.kind === 'repository' ? UNRESOLVED : OTHER;
}

// `resolve` starts from the working directory, which is the repository root under Vitest.
function resolveStep(base: Value, segment: Value): Value {
	if (segment.kind === 'repository') return segment;
	if (segment.kind === 'text') return isAbsolute(segment.text) ? segment : join(base, segment);
	return OTHER;
}

function dirname(value: Value): Value {
	if (value.kind === 'text') return { kind: 'text', text: path.posix.dirname(value.text) };
	if (value.kind === 'repository' && value.path !== undefined) {
		return repository(path.posix.dirname(value.path));
	}
	return value.kind === 'repository' ? UNRESOLVED : OTHER;
}

/**
 * Finds every filesystem read, import and child process in `entries` and the repository
 * files they import, transitively, whose path the source builds from the repository root,
 * and reports each one no input covers. `read` returns a repository file's text.
 */
function repositoryReads(
	read: (file: string) => string | undefined,
	entries: readonly string[]
): Finding[] {
	const findings: Finding[] = [];
	const sources = new Map<string, ts.SourceFile>();
	const imports = new Map<string, Map<string, string>>();
	const queue = [...entries];
	for (let file = queue.shift(); file !== undefined; file = queue.shift()) {
		if (sources.has(file)) continue;
		const text = read(file);
		if (text === undefined) continue;
		const source = ts.createSourceFile(
			`/${file}`,
			text,
			ts.ScriptTarget.Latest,
			true,
			ts.ScriptKind.TS
		);
		sources.set(file, source);
		const resolved = new Map<string, string>();
		imports.set(file, resolved);
		for (const specifier of moduleSpecifiers(source)) {
			if (!specifier.text.startsWith('.')) continue;
			const target = path.posix.normalize(
				path.posix.join(path.posix.dirname(file), specifier.text)
			);
			const found = [
				target,
				`${target}.ts`,
				target.replace(/\.js$/, '.ts'),
				`${target}/index.ts`
			].find((candidate) => read(candidate) !== undefined);
			if (!found || !covered(found)) {
				findings.push({
					file,
					line: lineOf(specifier),
					scope: '<imports>',
					problem: `imports ${found ?? target}, which ${found ? 'is not an input' : 'does not exist'}`
				});
			}
			if (!found) continue;
			resolved.set(specifier.text, found);
			if (SOURCE.test(found)) queue.push(found);
		}
	}

	const host: ts.CompilerHost = {
		getSourceFile: (name) => sources.get(name.slice(1)),
		getDefaultLibFileName: () => '/lib.d.ts',
		writeFile: () => {},
		getCurrentDirectory: () => '/',
		getCanonicalFileName: (name) => name,
		useCaseSensitiveFileNames: () => true,
		getNewLine: () => '\n',
		fileExists: (name) => sources.has(name.slice(1)),
		readFile: () => undefined,
		resolveModuleNameLiterals: (literals, containing) =>
			literals.map((literal) => {
				const found = imports.get(containing.slice(1))?.get(literal.text);
				return {
					resolvedModule:
						found && sources.has(found)
							? { resolvedFileName: `/${found}`, extension: ts.Extension.Ts }
							: undefined
				};
			})
	};
	const program = ts.createProgram({
		rootNames: [...sources.keys()].map((file) => `/${file}`),
		options: {
			noLib: true,
			types: [],
			target: ts.ScriptTarget.Latest,
			module: ts.ModuleKind.ESNext
		},
		host
	});
	const checker = program.getTypeChecker();

	const symbolOf = (node: ts.Node): ts.Symbol | undefined => {
		const symbol = checker.getSymbolAtLocation(node);
		if (!symbol || !(symbol.flags & ts.SymbolFlags.Alias)) return symbol;
		const aliased = checker.getAliasedSymbol(symbol);
		return aliased.declarations?.length ? aliased : symbol;
	};

	// Every assignment and every call of a local binding, so a variable's value includes
	// what is assigned later and a parameter's includes what each caller passes.
	const assignments = new Map<ts.Symbol, ts.Expression[]>();
	const appended = new Set<ts.Symbol>();
	const calls = new Map<ts.Symbol, ts.CallExpression[]>();
	const record = <T>(map: Map<ts.Symbol, T[]>, symbol: ts.Symbol | undefined, value: T) => {
		if (symbol) map.set(symbol, [...(map.get(symbol) ?? []), value]);
	};
	for (const source of sources.values()) {
		const visit = (node: ts.Node): void => {
			if (ts.isBinaryExpression(node) && ts.isIdentifier(node.left)) {
				const operator = node.operatorToken.kind;
				if (operator === ts.SyntaxKind.PlusEqualsToken) {
					const symbol = symbolOf(node.left);
					if (symbol) appended.add(symbol);
				} else if (
					operator === ts.SyntaxKind.EqualsToken ||
					operator === ts.SyntaxKind.QuestionQuestionEqualsToken ||
					operator === ts.SyntaxKind.BarBarEqualsToken
				) {
					record(assignments, symbolOf(node.left), node.right);
				}
			}
			if (ts.isCallExpression(node)) {
				const callee = ts.isPropertyAccessExpression(node.expression)
					? node.expression.name
					: node.expression;
				record(calls, symbolOf(callee), node);
			}
			ts.forEachChild(node, visit);
		};
		visit(source);
	}

	/** The module and export a callee comes from, through named, namespace or global access. */
	const importedFrom = (node: ts.Expression): { module: string; name: string } | undefined => {
		if (ts.isIdentifier(node)) {
			const symbol = checker.getSymbolAtLocation(node);
			if (!symbol) {
				if (node.text === 'Bun') return { module: 'bun', name: '*' };
				return node.text === 'process' ? { module: 'process', name: '*' } : undefined;
			}
			const declaration = symbol.declarations?.[0];
			if (!declaration) return undefined;
			const module = (statement: ts.Node) =>
				ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)
					? statement.moduleSpecifier.text
							.replace(/^node:/, '')
							.replace(/\/(?:promises|posix|win32)$/, '')
					: undefined;
			if (ts.isImportSpecifier(declaration)) {
				const from = module(declaration.parent.parent.parent);
				return from
					? { module: from, name: (declaration.propertyName ?? declaration.name).text }
					: undefined;
			}
			if (ts.isNamespaceImport(declaration)) {
				const from = module(declaration.parent.parent);
				return from ? { module: from, name: '*' } : undefined;
			}
			if (ts.isImportClause(declaration)) {
				const from = module(declaration.parent);
				return from ? { module: from, name: '*' } : undefined;
			}
			return undefined;
		}
		if (ts.isPropertyAccessExpression(node)) {
			const base = importedFrom(node.expression);
			if (base && ['*', 'promises', 'posix', 'win32', 'default'].includes(base.name)) {
				return { module: base.module, name: node.name.text };
			}
		}
		return undefined;
	};

	const isImportMeta = (node: ts.Expression) =>
		ts.isMetaProperty(node) && node.keywordToken === ts.SyntaxKind.ImportKeyword;

	const functionOf = (declaration: ts.Declaration): ts.SignatureDeclaration | undefined => {
		if (ts.isFunctionDeclaration(declaration) || ts.isMethodDeclaration(declaration))
			return declaration;
		if (ts.isVariableDeclaration(declaration) && declaration.initializer) {
			const initializer = skipOuter(declaration.initializer);
			if (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer))
				return initializer;
		}
		return undefined;
	};

	const returned = (fn: ts.SignatureDeclaration): ts.Expression[] => {
		if (!('body' in fn) || !fn.body) return [];
		if (!ts.isBlock(fn.body)) return [fn.body as ts.Expression];
		const results: ts.Expression[] = [];
		const visit = (node: ts.Node): void => {
			if (ts.isFunctionLike(node)) return;
			if (ts.isReturnStatement(node) && node.expression) results.push(node.expression);
			ts.forEachChild(node, visit);
		};
		ts.forEachChild(fn.body, visit);
		return results;
	};

	const memo = new Map<ts.Node, Value[]>();
	const evaluate = (node: ts.Expression): Value[] => {
		const known = memo.get(node);
		if (known) return known;
		// A cycle, such as a recursive helper, contributes nothing new.
		memo.set(node, [OTHER]);
		const values = distinct(compute(skipOuter(node)));
		memo.set(node, values);
		return values;
	};
	const union = (...nodes: ts.Expression[]) => distinct(nodes.flatMap((node) => evaluate(node)));

	const compute = (node: ts.Expression): Value[] => {
		if (ts.isStringLiteralLike(node)) return [{ kind: 'text', text: node.text }];
		if (ts.isTemplateExpression(node)) {
			const parts: Value[][] = [[{ kind: 'text', text: node.head.text }]];
			for (const span of node.templateSpans) {
				parts.push(evaluate(span.expression), [{ kind: 'text', text: span.literal.text }]);
			}
			return combine(parts, concat);
		}
		if (ts.isBinaryExpression(node)) {
			const operator = node.operatorToken.kind;
			if (operator === ts.SyntaxKind.PlusToken) {
				return combine([evaluate(node.left), evaluate(node.right)], concat);
			}
			if (
				operator === ts.SyntaxKind.QuestionQuestionToken ||
				operator === ts.SyntaxKind.BarBarToken ||
				operator === ts.SyntaxKind.AmpersandAmpersandToken
			) {
				return union(node.left, node.right);
			}
			return [OTHER];
		}
		if (ts.isConditionalExpression(node)) return union(node.whenTrue, node.whenFalse);
		// An array stands for the rooted paths in it, so arguments passed along keep them.
		if (ts.isArrayLiteralExpression(node)) {
			return elements(node).map((value) => (value.kind === 'repository' ? value : OTHER));
		}
		if (ts.isIdentifier(node)) return identifier(node);
		if (ts.isPropertyAccessExpression(node)) return property(node);
		if (ts.isElementAccessExpression(node)) return tainted(node.expression);
		if (ts.isNewExpression(node)) return construct(node);
		if (ts.isCallExpression(node)) return call(node);
		return [OTHER];
	};

	/** What a member or method of `receiver` yields when nothing more is known. */
	const tainted = (receiver: ts.Expression): Value[] =>
		evaluate(receiver).some((value) => value.kind === 'repository') ? [UNRESOLVED] : [OTHER];

	const identifier = (node: ts.Identifier): Value[] => {
		const symbol = symbolOf(node);
		if (!symbol) {
			const file = node.getSourceFile().fileName.slice(1);
			if (node.text === '__dirname') return [repository(path.posix.dirname(file))];
			if (node.text === '__filename') return [repository(file)];
			return [OTHER];
		}
		const values: Value[] = [];
		for (const declaration of symbol.declarations ?? []) {
			if (ts.isVariableDeclaration(declaration) && ts.isIdentifier(declaration.name)) {
				const statement = declaration.parent.parent;
				if (ts.isForOfStatement(statement)) values.push(...elements(statement.expression));
				else if (declaration.initializer) values.push(...evaluate(declaration.initializer));
			} else if (ts.isParameter(declaration)) {
				values.push(...parameter(declaration));
			} else if (ts.isBindingElement(declaration)) {
				values.push(...destructured(declaration));
			} else {
				values.push(OTHER);
			}
		}
		for (const assigned of assignments.get(symbol) ?? []) values.push(...evaluate(assigned));
		const result = values.length ? values : [OTHER];
		return appended.has(symbol)
			? result.map((value) => (value.kind === 'repository' ? UNRESOLVED : value))
			: result;
	};

	// A parameter holds whatever any caller passes; one passed as a callback holds unknowns.
	const parameter = (declaration: ts.ParameterDeclaration): Value[] => {
		const values = declaration.initializer ? [...evaluate(declaration.initializer)] : [];
		if (declaration.dotDotDotToken) return [...values, OTHER];
		const fn = declaration.parent;
		const index = fn.parameters.indexOf(declaration);
		const name =
			ts.isFunctionDeclaration(fn) || ts.isMethodDeclaration(fn)
				? fn.name
				: ts.isVariableDeclaration(fn.parent)
					? fn.parent.name
					: undefined;
		const symbol = name ? symbolOf(name) : undefined;
		for (const site of (symbol && calls.get(symbol)) ?? []) {
			const spread = site.arguments.findIndex(ts.isSpreadElement);
			const argument = site.arguments[index];
			if (spread !== -1 && spread <= index) values.push(OTHER);
			else if (argument) values.push(...evaluate(argument));
		}
		return values.length ? values : [OTHER];
	};

	// A name destructured from a rooted value is rooted somewhere the analysis does not follow.
	const destructured = (element: ts.BindingElement): Value[] => {
		let owner: ts.Node = element;
		while (
			ts.isBindingElement(owner) ||
			ts.isObjectBindingPattern(owner) ||
			ts.isArrayBindingPattern(owner)
		) {
			owner = owner.parent;
		}
		if (!ts.isVariableDeclaration(owner)) return [OTHER];
		const statement = owner.parent.parent;
		const source = ts.isForOfStatement(statement)
			? elements(statement.expression)
			: owner.initializer
				? evaluate(owner.initializer)
				: [];
		return source.some((value) => value.kind === 'repository') ? [UNRESOLVED] : [OTHER];
	};

	/** The values an iterable yields, for `for (const x of ...)`. */
	const elements = (node: ts.Expression): Value[] => {
		const inner = skipOuter(node);
		if (ts.isArrayLiteralExpression(inner)) {
			return distinct(
				inner.elements.flatMap((element) =>
					ts.isSpreadElement(element) ? elements(element.expression) : evaluate(element)
				)
			);
		}
		if (ts.isIdentifier(inner)) {
			const declaration = symbolOf(inner)?.declarations?.[0];
			if (declaration && ts.isVariableDeclaration(declaration) && declaration.initializer) {
				return elements(declaration.initializer);
			}
		}
		if (ts.isCallExpression(inner) && ts.isPropertyAccessExpression(inner.expression)) {
			const method = inner.expression.name.text;
			if (['filter', 'slice', 'toSorted', 'reverse', 'concat'].includes(method)) {
				return elements(inner.expression.expression);
			}
			const mapper = inner.arguments[0] && skipOuter(inner.arguments[0]);
			if ((method === 'map' || method === 'flatMap') && mapper && ts.isArrowFunction(mapper)) {
				return union(...returned(mapper));
			}
		}
		return evaluate(inner).map((value) => (value.kind === 'text' ? OTHER : value));
	};

	const property = (node: ts.PropertyAccessExpression): Value[] => {
		const name = node.name.text;
		if (isImportMeta(node.expression)) {
			const file = node.getSourceFile().fileName.slice(1);
			if (name === 'dirname') return [repository(path.posix.dirname(file))];
			if (name === 'filename') return [repository(file)];
			if (name === 'url') return [repository(file, true)];
			return [OTHER];
		}
		if (name === 'pathname' || name === 'href') return evaluate(node.expression);
		if (ts.isIdentifier(node.expression)) {
			const declaration = symbolOf(node.expression)?.declarations?.[0];
			const initializer =
				declaration && ts.isVariableDeclaration(declaration) && declaration.initializer
					? skipOuter(declaration.initializer)
					: undefined;
			if (initializer && ts.isObjectLiteralExpression(initializer)) {
				const member = initializer.properties.find(
					(candidate) =>
						candidate.name && ts.isIdentifier(candidate.name) && candidate.name.text === name
				);
				if (member && ts.isPropertyAssignment(member)) return evaluate(member.initializer);
				if (member && ts.isShorthandPropertyAssignment(member)) return evaluate(member.name);
			}
		}
		return tainted(node.expression);
	};

	// `new URL(spec, base)` resolves against the base's directory unless the base is one.
	const construct = (node: ts.NewExpression): Value[] => {
		const [spec, base] = node.arguments ?? [];
		if (!ts.isIdentifier(node.expression) || node.expression.text !== 'URL' || !spec || !base) {
			return [OTHER];
		}
		return combine([evaluate(base), evaluate(spec)], (from, relative) => {
			if (from.kind !== 'repository')
				return from.kind === 'other' && relative.kind === 'repository' ? UNRESOLVED : OTHER;
			if (from.path === undefined || relative.kind !== 'text') return UNRESOLVED;
			const directory = from.fileUrl ? path.posix.dirname(from.path) : from.path;
			return repository(
				path.posix.join(directory, relative.text),
				!/(?:^|\/)\.{0,2}$|\/$/.test(relative.text)
			);
		});
	};

	const call = (node: ts.CallExpression): Value[] => {
		const callee = importedFrom(node.expression);
		const args = node.arguments.map((argument) => evaluate(argument));
		if (callee?.module === 'process' && callee.name === 'cwd') return [repository('')];
		if (callee?.module === 'path') {
			if (callee.name === 'join') return combine(args, join);
			if (callee.name === 'resolve') return combine([[repository('')], ...args], resolveStep);
			if (callee.name === 'normalize') return args[0] ?? [OTHER];
			if (callee.name === 'dirname') return (args[0] ?? [OTHER]).map(dirname);
			return [OTHER];
		}
		if (callee?.module === 'url' && ['fileURLToPath', 'pathToFileURL'].includes(callee.name)) {
			return args[0] ?? [OTHER];
		}
		if (callee?.module === 'fs' && callee.name.startsWith('realpath')) return args[0] ?? [OTHER];
		if (
			ts.isIdentifier(node.expression) &&
			node.expression.text === 'String' &&
			!symbolOf(node.expression)
		) {
			return args[0] ?? [OTHER];
		}
		const declaration = symbolOf(
			ts.isPropertyAccessExpression(node.expression) ? node.expression.name : node.expression
		)?.declarations?.[0];
		const fn = declaration && functionOf(declaration);
		if (fn) return union(...returned(fn));
		if (ts.isPropertyAccessExpression(node.expression)) {
			return node.expression.name.text === 'toString'
				? evaluate(node.expression.expression)
				: tainted(node.expression.expression);
		}
		return [OTHER];
	};

	/** The `cwd` a process or glob option bag sets: undefined if absent, null if unknowable. */
	const cwdOption = (options: ts.Expression | undefined): ts.Expression | undefined | null => {
		if (!options) return undefined;
		let bag = skipOuter(options);
		if (ts.isIdentifier(bag)) {
			const declaration = symbolOf(bag)?.declarations?.[0];
			if (!declaration || !ts.isVariableDeclaration(declaration) || !declaration.initializer)
				return null;
			bag = skipOuter(declaration.initializer);
		}
		if (!ts.isObjectLiteralExpression(bag)) return null;
		for (const member of bag.properties) {
			if (ts.isSpreadAssignment(member)) return null;
			if (!member.name || !ts.isIdentifier(member.name) || member.name.text !== 'cwd') continue;
			if (ts.isPropertyAssignment(member)) return member.initializer;
			if (ts.isShorthandPropertyAssignment(member)) return member.name;
		}
		return undefined;
	};

	const scopeOf = (node: ts.Node): string => {
		for (let current = node.parent; current; current = current.parent) {
			if ((ts.isFunctionDeclaration(current) || ts.isMethodDeclaration(current)) && current.name) {
				return current.name.getText();
			}
			if (ts.isArrowFunction(current) || ts.isFunctionExpression(current)) {
				const owner = current.parent;
				if (ts.isVariableDeclaration(owner)) return owner.name.getText();
				const title = ts.isCallExpression(owner) ? owner.arguments[0] : undefined;
				if (title && ts.isStringLiteralLike(title) && owner.arguments.includes(current)) {
					return title.text;
				}
			}
		}
		return '<top level>';
	};

	for (const [file, source] of sources) {
		const report = (node: ts.Node, problem: string) =>
			findings.push({ file, line: lineOf(node), scope: scopeOf(node), problem });
		// `relative` is set where the working directory resolves a relative path, as for fs.
		const checkPath = (node: ts.Node, values: Value[], verb: string, relative: boolean) => {
			for (const value of values) {
				const target = relative ? fromWorkingDirectory(value) : value;
				if (target.kind !== 'repository') continue;
				if (target.path === undefined) {
					report(node, `${verb} a path built from the repository root that is not a literal`);
				} else if (!covered(target.path)) {
					report(node, `${verb} ${target.path || 'the repository root'}, which is not an input`);
				}
			}
		};
		const checkProcess = (
			node: ts.Node,
			argv: ts.Expression | undefined,
			options: ts.Expression | undefined
		) => {
			const array = argv && skipOuter(argv);
			if (array && ts.isArrayLiteralExpression(array)) {
				for (const element of array.elements) {
					checkPath(
						element,
						ts.isSpreadElement(element) ? elements(element.expression) : evaluate(element),
						'passes',
						false
					);
				}
			} else if (array) {
				checkPath(array, elements(array), 'passes', false);
			}
			// A process without a working directory inherits the runner's, the repository root.
			const cwd = cwdOption(options);
			if (cwd === null) report(node, 'starts a process whose working directory is not a literal');
			else if (
				cwd === undefined ||
				evaluate(cwd).some((value) => fromWorkingDirectory(value).kind === 'repository')
			) {
				report(node, 'starts a process in the repository checkout');
			}
		};
		// A glob lists the directory before its first wildcard, which no file input covers.
		const checkGlob = (
			node: ts.Node,
			pattern: ts.Expression | undefined,
			cwd: ts.Expression | undefined | null
		) => {
			const bases =
				cwd === undefined ? [repository('')] : cwd === null ? [UNRESOLVED] : evaluate(cwd);
			const patterns: Value[] = pattern ? evaluate(pattern) : [{ kind: 'text', text: '' }];
			const prefixes = patterns.map((value): Value => {
				if (value.kind !== 'text') return value;
				const wildcard = value.text.search(/[*?[{]/);
				if (wildcard === -1) return value;
				return { kind: 'text', text: value.text.slice(0, wildcard).replace(/[^/]*$/, '') };
			});
			checkPath(node, combine([[repository('')], bases, prefixes], resolveStep), 'globs', false);
		};

		const visit = (node: ts.Node): void => {
			if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
				const [specifier] = node.arguments;
				if (specifier && !ts.isStringLiteralLike(specifier)) {
					checkPath(node, evaluate(specifier), 'imports', false);
				}
			} else if (ts.isCallExpression(node)) {
				const callee = importedFrom(node.expression);
				const [first, second, third] = node.arguments;
				if (callee?.module === 'fs' && callee.name.startsWith('glob')) {
					checkGlob(node, first, cwdOption(second));
				} else if (callee?.module === 'fs') {
					if (first) checkPath(first, evaluate(first), 'reads', true);
					if (second && TWO_PATH_FS.has(callee.name))
						checkPath(second, evaluate(second), 'reads', true);
				} else if (callee?.module === 'child_process' && SPAWNS.has(callee.name)) {
					// `exec` takes a command line and options; the rest take arguments before them.
					const shell = callee.name === 'exec' || callee.name === 'execSync';
					const optionsOnly = shell || (second && ts.isObjectLiteralExpression(skipOuter(second)));
					if (first) checkPath(first, evaluate(first), 'runs', false);
					if (optionsOnly) checkProcess(node, undefined, second);
					else checkProcess(node, second, third);
				} else if (callee?.module === 'bun' && ['file', 'write'].includes(callee.name)) {
					if (first) checkPath(first, evaluate(first), 'reads', true);
				} else if (callee?.module === 'bun' && ['spawn', 'spawnSync'].includes(callee.name)) {
					const single = first && ts.isObjectLiteralExpression(skipOuter(first));
					checkProcess(node, single ? undefined : first, single ? first : second);
				}
			} else if (ts.isTaggedTemplateExpression(node)) {
				const tag = importedFrom(node.tag);
				if (tag?.module === 'bun' && tag.name === '$') {
					report(node, 'starts a shell in the repository checkout');
				}
			}
			ts.forEachChild(node, visit);
		};
		visit(source);
	}

	return findings.toSorted((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
}

/** The expression under parentheses, type assertions, `satisfies`, `!` and `await`. */
function skipOuter(node: ts.Expression): ts.Expression {
	while (
		ts.isParenthesizedExpression(node) ||
		ts.isAsExpression(node) ||
		ts.isSatisfiesExpression(node) ||
		ts.isNonNullExpression(node) ||
		ts.isTypeAssertionExpression(node) ||
		ts.isAwaitExpression(node)
	) {
		node = node.expression;
	}
	return node;
}

function lineOf(node: ts.Node): number {
	const source = node.getSourceFile();
	return source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
}

function moduleSpecifiers(source: ts.SourceFile): ts.StringLiteralLike[] {
	const specifiers: ts.StringLiteralLike[] = [];
	const visit = (node: ts.Node): void => {
		if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
			if (ts.isStringLiteralLike(node.moduleSpecifier)) specifiers.push(node.moduleSpecifier);
		} else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
			const [specifier] = node.arguments;
			if (specifier && ts.isStringLiteralLike(specifier)) specifiers.push(specifier);
		}
		ts.forEachChild(node, visit);
	};
	visit(source);
	return specifiers;
}

function suiteFiles(directory: string): string[] {
	return readdirSync(path.join(ROOT, directory)).flatMap((name) => {
		const file = path.posix.join(directory, name);
		if (statSync(path.join(ROOT, file)).isDirectory()) return suiteFiles(file);
		return SOURCE.test(name) ? [file] : [];
	});
}

const format = ({ file, line, scope, problem }: Finding) =>
	`${file}:${line} (${scope}): ${problem}`;

describe('upstream report suite reads', () => {
	it('reads only declared inputs of the repository', () => {
		const findings = repositoryReads((file) => {
			try {
				return readFileSync(path.join(ROOT, file), 'utf8');
			} catch {
				return undefined;
			}
		}, suiteFiles(SUITE));
		const allowed = (file: string, scope: string) =>
			scope !== '<imports>' &&
			ALLOWED.some((entry) => entry.file === file && entry.scopes.includes(scope));
		expect(
			findings.filter(({ file, scope }) => !allowed(file, scope)).map(format),
			'Declare each repository path the suite reads in UPSTREAM_REPORT_TEST_INPUTS and the ' +
				'job checkout, build it from a temporary directory, or allow its scope with a reason.'
		).toEqual([]);
		const unused = ALLOWED.flatMap(({ file, scopes }) =>
			scopes
				.filter(
					(scope) => !findings.some((finding) => finding.file === file && finding.scope === scope)
				)
				.map((scope) => `${file} (${scope})`)
		);
		expect(unused, 'Remove allowed scopes that no longer access the repository.').toEqual([]);
	});

	const planted = `${SUITE}/planted.test.ts`;
	const analyze = (source: string, extra: Record<string, string> = {}) =>
		repositoryReads((file) => ({ [planted]: source, ...extra })[file], [planted]).map(
			({ problem }) => problem
		);
	const header = [
		"import { execFileSync, spawnSync } from 'node:child_process';",
		"import { existsSync, globSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs';",
		"import { tmpdir } from 'node:os';",
		"import { join, resolve } from 'node:path';",
		"import { fileURLToPath } from 'node:url';"
	].join('\n');

	it.each([
		['a literal optional read', "existsSync(resolve(process.cwd(), 'README.md'));", 'README.md'],
		[
			'an optional read through a root variable',
			"const r = resolve(import.meta.dirname, '../../../..');\nexistsSync(join(r, 'docs/x.md'));",
			'docs/x.md'
		],
		[
			'a read through a file URL',
			"readFileSync(fileURLToPath(new URL('../../../../README.md', import.meta.url)));",
			'README.md'
		],
		['a read relative to the working directory', "existsSync('README.md');", 'README.md'],
		[
			'a listing of the root',
			"readdirSync(resolve(import.meta.dirname, '../../../..'));",
			'the repository root'
		],
		[
			'a glob of the repository',
			"globSync('docs/**/*.md', { cwd: resolve(import.meta.dirname, '../../../..') });",
			'globs docs'
		],
		[
			'a read through a helper parameter',
			"const root = resolve(import.meta.dirname, '../../../..');\nfunction optional(file: string) {\n\treturn existsSync(file);\n}\noptional(join(root, 'README.md'));",
			'README.md'
		],
		[
			'a root path built from a name',
			'const root = process.cwd();\nfor (const name of names()) existsSync(join(root, name));',
			'not a literal'
		],
		[
			'a Git read in the checkout',
			"execFileSync('git', ['show', 'HEAD:README.md']);",
			'in the repository checkout'
		]
	])('fails on %s', (_label, body, problem) => {
		expect(analyze(`${header}\n${body}\n`)).toEqual([expect.stringContaining(problem)]);
	});

	it('fails on an import of a file that is not an input', () => {
		expect(
			analyze(`import { value } from '../../../../src/lib/value';\nvalue();\n`, {
				'src/lib/value.ts': 'export const value = () => 1;\n'
			})
		).toEqual([expect.stringContaining('src/lib/value.ts')]);
	});

	it('passes reads of declared inputs and temporary directories', () => {
		const body = [
			"const root = resolve(import.meta.dirname, '../../../..');",
			"readFileSync(resolve(root, 'package.json'), 'utf8');",
			"existsSync(join(root, 'patches'));",
			"readFileSync(resolve(import.meta.dirname, 'upstream-relevance.ts'), 'utf8');",
			"for (const name of readdirSync(tmpdir())) readFileSync(join(tmpdir(), name, 'owner'), 'utf8');",
			"const tmp = mkdtempSync(join(tmpdir(), 'fixture-'));",
			"spawnSync('git', ['init', '-q'], { cwd: tmp });",
			"spawnSync('bun', [resolve(process.cwd(), '.agents/skills/upstream-report/scripts/upstream-relevance.ts')], { cwd: join(tmp, 'fork') });"
		].join('\n');
		expect(analyze(`${header}\n${body}\n`)).toEqual([]);
	});
});
