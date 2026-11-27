import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { parse, type AST } from 'svelte/compiler';
import ts from 'typescript';
import { afterAll, describe, expect, it } from 'vitest';
import en from '../src/i18n/en.json';

const PRIMITIVES = path.resolve('src/lib/components/ui');
const TOLGEE_SCOPE = '@tolgee/';
const TOLGEE_SVELTE = '@tolgee/svelte';
const OUTSIDE_LOOKUP = 'the Tolgee binding is used outside a key lookup';

interface Problem {
	readonly file: string;
	readonly line: number;
	readonly expression: string;
	readonly message: string;
}

interface Findings {
	readonly problems: readonly Problem[];
	readonly keys: readonly string[];
}

interface AccountedSite {
	readonly file: string;
	readonly expression: string;
	readonly carrier: string;
	readonly keyType: string;
}

const ACCOUNTED_SITES: readonly AccountedSite[] = [];

interface KeySyntax<Node> {
	readonly literal: (node: Node) => string | undefined;
	readonly branches: (node: Node) => readonly [Node, Node] | undefined;
}

function staticKeys<Node>(
	node: Node | undefined,
	syntax: KeySyntax<Node>
): readonly string[] | undefined {
	if (node === undefined) return undefined;
	const key = syntax.literal(node);
	if (key !== undefined) return [key];
	const branches = syntax.branches(node)?.map(syntax.literal);
	return branches?.every((branch): branch is string => branch !== undefined) ? branches : undefined;
}

interface EsNode {
	readonly type: string;
	readonly start: number;
	readonly end: number;
	readonly [field: string]: unknown;
}

function isEsNode(value: unknown): value is EsNode {
	return (
		typeof value === 'object' &&
		value !== null &&
		'type' in value &&
		typeof value.type === 'string' &&
		'start' in value &&
		typeof value.start === 'number'
	);
}

function esDescendants(value: unknown): EsNode[] {
	if (Array.isArray(value)) return value.flatMap(esDescendants);
	if (typeof value !== 'object' || value === null || !('type' in value)) return [];
	const children = Object.entries(value).flatMap(([field, child]) =>
		field === 'metadata' ? [] : esDescendants(child)
	);
	return isEsNode(value) ? [value, ...children] : children;
}

const esSyntax: KeySyntax<EsNode> = {
	literal: (node) => {
		if (node.type === 'Literal') return typeof node.value === 'string' ? node.value : undefined;
		if (node.type !== 'TemplateLiteral') return undefined;
		const { expressions, quasis } = node;
		if (!Array.isArray(expressions) || expressions.length > 0 || !Array.isArray(quasis)) {
			return undefined;
		}
		const [quasi] = quasis.filter(isEsNode);
		const value: unknown = quasi?.value;
		return typeof value === 'object' &&
			value !== null &&
			'cooked' in value &&
			typeof value.cooked === 'string'
			? value.cooked
			: undefined;
	},
	branches: (node) =>
		node.type === 'ConditionalExpression' && isEsNode(node.consequent) && isEsNode(node.alternate)
			? [node.consequent, node.alternate]
			: undefined
};

const tsSyntax: KeySyntax<ts.Expression> = {
	literal: (node) =>
		ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) ? node.text : undefined,
	branches: (node) =>
		ts.isConditionalExpression(node) ? [node.whenTrue, node.whenFalse] : undefined
};

interface Span {
	readonly start: number;
	readonly end: number;
}

function spanOf(node: unknown): Span {
	if (typeof node === 'object' && node !== null && 'start' in node && 'end' in node) {
		const { start, end } = node;
		if (typeof start === 'number' && typeof end === 'number') return { start, end };
	}
	throw new Error('a template node has no source position');
}

interface Piece {
	readonly synthetic: number;
	readonly original: number;
	readonly length: number;
}

interface Synthesis {
	readonly text: string;
	readonly pieces: readonly Piece[];
	readonly components: ReadonlyMap<number, AST.Component>;
	readonly instance: number;
}

function synthesize(source: string, root: AST.Root): Synthesis {
	let text = '';
	const pieces: Piece[] = [];
	const components = new Map<number, AST.Component>();
	const glue = (more: string): void => {
		text += more;
	};
	const copy = ({ start, end }: Span): void => {
		pieces.push({ synthetic: text.length, original: start, length: end - start });
		text += source.slice(start, end);
	};
	const statement = (node: unknown): void => {
		glue('(');
		copy(spanOf(node));
		glue(');\n');
	};
	const scope = (head: string, body: () => void): void => {
		glue(`${head} {\n`);
		body();
		glue('}\n');
	};
	const binding = (pattern: unknown, body: () => void): void => {
		glue('for (const ');
		if (pattern === null || pattern === undefined) glue('[]');
		else copy(spanOf(pattern));
		glue(' of [])');
		scope('', body);
	};
	const directiveName = (node: AST.BaseNode & { readonly name: string }): Span => {
		const start = source.indexOf(':', node.start) + 1;
		return { start, end: start + node.name.length };
	};
	const fragment = (node: AST.Fragment | null | undefined): void => {
		node?.nodes.forEach(templateNode);
	};
	const values = (value: AST.Attribute['value']): void => {
		if (value === true) return;
		for (const part of Array.isArray(value) ? value : [value]) {
			if (part.type === 'ExpressionTag') statement(part.expression);
		}
	};
	const attribute = (node: AST.BaseElement['attributes'][number]): void => {
		switch (node.type) {
			case 'Attribute':
				values(node.value);
				return;
			case 'StyleDirective':
				if (node.value === true) statement(directiveName(node));
				else values(node.value);
				return;
			case 'SpreadAttribute':
			case 'AttachTag':
			case 'BindDirective':
			case 'ClassDirective':
				statement(node.expression);
				return;
			case 'OnDirective':
				if (node.expression) statement(node.expression);
				return;
			case 'AnimateDirective':
			case 'TransitionDirective':
			case 'UseDirective':
				statement(directiveName(node));
				if (node.expression) statement(node.expression);
				return;
			case 'LetDirective':
				return;
		}
	};
	const element = (node: AST.ElementLike): void => {
		if (node.type === 'Component') {
			components.set(text.length + 1, node);
			statement({ start: node.start + 1, end: node.start + 1 + node.name.length });
		}
		if (node.type === 'SvelteComponent') statement(node.expression);
		if (node.type === 'SvelteElement') statement(node.tag);
		node.attributes.forEach(attribute);
		const lets = node.attributes.filter(
			(entry): entry is AST.LetDirective => entry.type === 'LetDirective'
		);
		const nest = (index: number): void => {
			const directive = lets[index];
			if (directive === undefined) fragment(node.fragment);
			else binding(directive.expression ?? directiveName(directive), () => nest(index + 1));
		};
		scope('', () => nest(0));
	};
	const templateNode = (node: AST.Fragment['nodes'][number]): void => {
		switch (node.type) {
			case 'Text':
			case 'Comment':
				return;
			case 'ExpressionTag':
			case 'HtmlTag':
			case 'RenderTag':
			case 'AttachTag':
				statement(node.expression);
				return;
			case 'ConstTag':
			case 'DeclarationTag':
				copy(spanOf(node.declaration));
				glue(';\n');
				return;
			case 'DebugTag':
				node.identifiers.forEach(statement);
				return;
			case 'IfBlock':
				glue('if (');
				copy(spanOf(node.test));
				glue(')');
				scope('', () => fragment(node.consequent));
				scope('else', () => fragment(node.alternate));
				return;
			case 'EachBlock':
				statement(node.expression);
				binding(node.context, () => {
					if (node.index !== undefined) glue(`let ${node.index} = 0;\n`);
					if (node.key !== undefined) statement(node.key);
					fragment(node.body);
				});
				scope('', () => fragment(node.fallback));
				return;
			case 'AwaitBlock':
				statement(node.expression);
				scope('', () => fragment(node.pending));
				binding(node.value, () => fragment(node.then));
				binding(node.error, () => fragment(node.catch));
				return;
			case 'KeyBlock':
				statement(node.expression);
				scope('', () => fragment(node.fragment));
				return;
			case 'SnippetBlock':
				glue('function ');
				copy(spanOf(node.expression));
				glue('(');
				node.parameters.forEach((parameter, index) => {
					if (index > 0) glue(', ');
					copy(spanOf(parameter));
				});
				glue(')');
				scope('', () => fragment(node.body));
				return;
			default:
				element(node);
		}
	};
	const statements = (script: AST.Script | null | undefined, imports: boolean): void => {
		for (const node of script?.content.body ?? []) {
			if ((node.type === 'ImportDeclaration') !== imports) continue;
			copy(spanOf(node));
			glue(';\n');
		}
	};
	statements(root.module, true);
	statements(root.instance, true);
	statements(root.module, false);
	glue('(');
	const instance = text.length;
	glue('function () {\n');
	statements(root.instance, false);
	fragment(root.fragment);
	glue('});\n');
	return { text, pieces, components, instance };
}

interface Unit {
	readonly file: string;
	readonly source: string;
	readonly text: string;
	readonly original: (offset: number) => number;
	readonly components: ReadonlyMap<number, AST.Component>;
	readonly instance: number | undefined;
}

type Role = 'entry' | 'component' | 'translate' | 'other';

interface Binding {
	readonly role: Role;
	readonly declaration: ts.Identifier;
}

const catalog = new Set(leafKeys(en));

function leafKeys(value: unknown, prefix = ''): string[] {
	if (typeof value === 'string') return [prefix];
	if (value === null || typeof value !== 'object') return [];
	return Object.entries(value).flatMap(([key, child]) =>
		leafKeys(child, prefix ? `${prefix}.${key}` : key)
	);
}

function lineOf(source: string, offset: number): number {
	return source.slice(0, offset).split('\n').length;
}

function fromTolgee(node: ts.Node | undefined): node is ts.StringLiteralLike {
	return node !== undefined && ts.isStringLiteralLike(node) && node.text.startsWith(TOLGEE_SCOPE);
}

function importRole(module: ts.StringLiteralLike, imported: ts.ModuleExportName): Role {
	if (module.text !== TOLGEE_SVELTE) return 'other';
	if (imported.text === 'getTranslate') return 'entry';
	return imported.text === 'T' ? 'component' : 'other';
}

function entryElements(
	declaration: ts.VariableDeclaration
): ReadonlyArray<{ readonly property: string; readonly local: ts.Identifier }> | undefined {
	const list = declaration.parent;
	const constant = ts.isVariableDeclarationList(list) && (list.flags & ts.NodeFlags.Const) !== 0;
	const exported = (ts.getCombinedModifierFlags(declaration) & ts.ModifierFlags.Export) !== 0;
	if (!constant || exported || !ts.isObjectBindingPattern(declaration.name)) return undefined;
	const elements = declaration.name.elements.map((element) => {
		const property = element.propertyName ?? element.name;
		const plain = !element.dotDotDotToken && !element.initializer && ts.isIdentifier(property);
		return plain && ts.isIdentifier(element.name)
			? { property: property.text, local: element.name }
			: undefined;
	});
	return elements.every((element) => element !== undefined) ? elements : undefined;
}

function typePosition(node: ts.Node): boolean {
	const { parent } = node;
	if (parent === undefined) return false;
	if (ts.isExpressionWithTypeArguments(parent) && parent.expression === node) {
		const clause = parent.parent;
		return (
			ts.isHeritageClause(clause) &&
			(clause.token === ts.SyntaxKind.ImplementsKeyword || ts.isInterfaceDeclaration(clause.parent))
		);
	}
	return ts.isTypeNode(parent) || typePosition(parent);
}

function analyze(unit: Unit): Findings {
	const name = path.posix.join('/primitive', `${unit.file}.ts`);
	const options: ts.CompilerOptions = {
		noLib: true,
		noResolve: true,
		types: [],
		alwaysStrict: true
	};
	const sourceFile = ts.createSourceFile(
		name,
		unit.text,
		ts.ScriptTarget.Latest,
		true,
		ts.ScriptKind.TS
	);
	const host = ts.createCompilerHost(options);
	host.getSourceFile = (requested) => (requested === name ? sourceFile : undefined);
	host.fileExists = (requested) => requested === name;
	const checker = ts.createProgram({ rootNames: [name], options, host }).getTypeChecker();
	const nodes: ts.Node[] = [];
	const visit = (node: ts.Node): void => {
		nodes.push(node);
		ts.forEachChild(node, visit);
	};
	visit(sourceFile);

	const problems: Problem[] = [];
	const keys: string[] = [];
	const report = (offset: number, expression: string, message: string): void => {
		problems.push({ file: unit.file, line: lineOf(unit.source, offset), expression, message });
	};
	const reportAt = (node: ts.Node, expression: string, message: string): void =>
		report(unit.original(node.getStart(sourceFile)), expression, message);
	const lookup = (
		offset: number,
		expression: string,
		found: readonly string[] | undefined
	): void => {
		if (found === undefined) {
			report(offset, expression, 'the key is not a literal');
			return;
		}
		keys.push(...found);
		found
			.filter((key) => !catalog.has(key))
			.forEach((key) => report(offset, expression, `${key} is not in en.json`));
	};

	const symbolOf = (node: ts.Identifier): ts.Symbol | undefined => {
		const { parent } = node;
		if (ts.isShorthandPropertyAssignment(parent) && parent.name === node) {
			return checker.getShorthandAssignmentValueSymbol(parent);
		}
		if (ts.isExportSpecifier(parent)) {
			return node === (parent.propertyName ?? parent.name)
				? checker.getExportSpecifierLocalTargetSymbol(parent)
				: undefined;
		}
		return checker.getSymbolAtLocation(node);
	};
	const tracked = new Map<ts.Symbol, Binding>();
	const bindingOf = (node: ts.Identifier): Binding | undefined => {
		const symbol = symbolOf(node);
		return symbol === undefined ? undefined : tracked.get(symbol);
	};
	const track = (declaration: ts.Identifier, role: Role): void => {
		const symbol = checker.getSymbolAtLocation(declaration);
		if (symbol !== undefined) tracked.set(symbol, { role, declaration });
	};

	for (const node of nodes) {
		if (ts.isImportDeclaration(node) && fromTolgee(node.moduleSpecifier)) {
			const clause = node.importClause;
			if (clause === undefined || clause.isTypeOnly) continue;
			if (clause.name) track(clause.name, 'other');
			const bindings = clause.namedBindings;
			if (bindings && ts.isNamespaceImport(bindings)) track(bindings.name, 'other');
			if (bindings && ts.isNamedImports(bindings)) {
				for (const element of bindings.elements) {
					if (element.isTypeOnly) continue;
					track(
						element.name,
						importRole(node.moduleSpecifier, element.propertyName ?? element.name)
					);
				}
			}
		}
		if (ts.isExportDeclaration(node) && !node.isTypeOnly && fromTolgee(node.moduleSpecifier)) {
			reportAt(
				node,
				node.moduleSpecifier.getText(sourceFile),
				'the module re-exports the Tolgee API'
			);
		}
		if (
			ts.isCallExpression(node) &&
			node.expression.kind === ts.SyntaxKind.ImportKeyword &&
			fromTolgee(node.arguments[0])
		) {
			reportAt(node, node.getText(sourceFile), 'the module imports the Tolgee API at runtime');
		}
	}

	const entries = new Set<ts.Node>();
	for (const node of nodes) {
		if (!ts.isVariableDeclaration(node) || node.initializer === undefined) continue;
		if (!ts.isCallExpression(node.initializer)) continue;
		const callee = node.initializer.expression;
		if (!ts.isIdentifier(callee) || bindingOf(callee)?.role !== 'entry') continue;
		const elements = entryElements(node);
		if (elements === undefined) continue;
		entries.add(callee);
		elements.forEach(({ property, local }) =>
			track(local, property === 't' ? 'translate' : 'other')
		);
	}

	const component = (node: ts.Identifier, element: AST.Component): void => {
		if (element.attributes.some((entry) => entry.type === 'SpreadAttribute')) {
			reportAt(node, node.text, 'the props of the Tolgee component are spread');
			return;
		}
		const keyName = element.attributes.find(
			(entry): entry is AST.Attribute => entry.type === 'Attribute' && entry.name === 'keyName'
		);
		if (keyName === undefined) {
			reportAt(node, node.text, 'the key is not a literal');
			return;
		}
		const parts = keyName.value === true ? [] : [keyName.value].flat();
		const [only] = parts.length === 1 ? parts : [];
		if (only?.type === 'Text') {
			lookup(keyName.start, only.data, [only.data]);
			return;
		}
		const expression = only?.type === 'ExpressionTag' ? spanOf(only.expression) : keyName;
		const found =
			only?.type === 'ExpressionTag' && isEsNode(only.expression)
				? staticKeys(only.expression, esSyntax)
				: undefined;
		lookup(keyName.start, unit.source.slice(expression.start, expression.end), found);
	};
	const store = (node: ts.Identifier, binding: Binding): void => {
		const call = node.parent;
		if (binding.role !== 'translate' || !ts.isCallExpression(call) || call.expression !== node) {
			reportAt(node, node.text, OUTSIDE_LOOKUP);
			return;
		}
		const [argument] = call.arguments;
		lookup(
			unit.original(call.getStart(sourceFile)),
			(argument ?? call).getText(sourceFile),
			staticKeys(argument, tsSyntax)
		);
	};

	const instance = nodes.find(
		(node): node is ts.FunctionExpression =>
			ts.isFunctionExpression(node) && node.getStart(sourceFile) === unit.instance
	);
	const resolve = (storeName: string, location: ts.Node): ts.Symbol | undefined =>
		checker.resolveName(storeName, location, ts.SymbolFlags.Value | ts.SymbolFlags.Alias, true);
	for (const node of nodes) {
		if (!ts.isIdentifier(node)) continue;
		const binding = bindingOf(node);
		if (binding !== undefined) {
			if (binding.declaration === node || entries.has(node) || typePosition(node)) continue;
			const element = unit.components.get(node.getStart(sourceFile));
			if (binding.role === 'component' && element !== undefined) component(node, element);
			else reportAt(node, node.text, OUTSIDE_LOOKUP);
			continue;
		}
		if (instance === undefined || !node.text.startsWith('$') || symbolOf(node) !== undefined) {
			continue;
		}
		const storeName = node.text.slice(1);
		const subscribed = resolve(storeName, instance.body);
		const target = subscribed === undefined ? undefined : tracked.get(subscribed);
		if (target === undefined) continue;
		if (resolve(storeName, node) === subscribed) store(node, target);
		else reportAt(node, node.text, 'the store name is declared again around the subscription');
	}
	return { problems, keys };
}

function svelteFindings(file: string, source: string): Findings {
	const root = parse(source, { modern: true });
	const { text, pieces, components, instance } = synthesize(source, root);
	const original = (offset: number): number => {
		const piece = pieces.find(
			(entry) => entry.synthetic <= offset && offset < entry.synthetic + entry.length
		);
		if (piece === undefined) throw new Error(`${file}: offset ${offset} is outside the source`);
		return piece.original + offset - piece.synthetic;
	};
	const unread = esDescendants(root.fragment)
		.filter((node) => node.type === 'Identifier')
		.filter(
			(node) =>
				!pieces.some(
					(piece) => piece.original <= node.start && node.end <= piece.original + piece.length
				)
		)
		.map((node) => ({
			file,
			line: lineOf(source, node.start),
			expression: source.slice(node.start, node.end),
			message: 'the template expression is outside the analysis'
		}));
	const found = analyze({ file, source, text, original, components, instance });
	return { problems: [...unread, ...found.problems], keys: found.keys };
}

function findings(file: string, source: string): Findings {
	if (file.endsWith('.svelte')) return svelteFindings(file, source);
	const components = new Map<number, AST.Component>();
	return analyze({
		file,
		source,
		text: source,
		original: (offset) => offset,
		components,
		instance: undefined
	});
}

function primitiveSources(directory: string): string[] {
	return fs
		.readdirSync(directory, { withFileTypes: true })
		.sort((a, b) => a.name.localeCompare(b.name))
		.flatMap((entry) => {
			const full = path.join(directory, entry.name);
			if (entry.isDirectory()) return entry.name === 'test-fixtures' ? [] : primitiveSources(full);
			const source = /\.(?:svelte|ts)$/.test(entry.name) && !entry.name.endsWith('.test.ts');
			return source ? [full] : [];
		});
}

function scan(
	root: string,
	base: string
): { readonly problems: string[]; readonly keys: Set<string> } {
	const results = primitiveSources(root).map((file) =>
		findings(path.relative(base, file), fs.readFileSync(file, 'utf8'))
	);
	const problems = results
		.flatMap((result) => [...result.problems].sort((a, b) => a.line - b.line))
		.filter(
			(problem) =>
				!ACCOUNTED_SITES.some(
					(entry) => entry.file === problem.file && entry.expression === problem.expression
				)
		)
		.map(({ file, line, expression, message }) => `${file}:${line} ${expression}: ${message}`);
	return { problems, keys: new Set(results.flatMap((result) => result.keys)) };
}

const IMPORT_TRANSLATE = "\timport { getTranslate } from '@tolgee/svelte';";
const DECLARE_TRANSLATE = '\tconst { t } = getTranslate();';
const MODULE_SCRIPT = '<script module lang="ts">';
const TYPE_QUERY = [
	'<script lang="ts">',
	"\timport { T as TranslationLabel } from '@tolgee/svelte';",
	"\timport type { ComponentProps } from 'svelte';",
	'\ttype LabelProps = ComponentProps<typeof TranslationLabel>;',
	'\tlet { extra }: { extra?: Partial<LabelProps> } = $props();',
	'</script>',
	'<span hidden={extra === undefined}><TranslationLabel keyName="aria.copy" /></span>'
];

const FIXTURES = [
	{
		name: 'the store read through get',
		file: 'get-store.svelte',
		source: [
			'<script lang="ts">',
			"\timport { get } from 'svelte/store';",
			IMPORT_TRANSLATE,
			DECLARE_TRANSLATE,
			"\tconst label = get(t)('missing.through_get');",
			'</script>',
			'<span>{label}</span>'
		],
		problems: [`get-store.svelte:5 t: ${OUTSIDE_LOOKUP}`]
	},
	{
		name: 'the aliased component with a dynamic key',
		file: 'alias-dynamic.svelte',
		source: [
			'<script lang="ts">',
			"\timport { T as Label } from '@tolgee/svelte';",
			'\tlet { fromApp }: { fromApp: string } = $props();',
			'</script>',
			'<Label keyName={fromApp} />'
		],
		problems: ['alias-dynamic.svelte:5 fromApp: the key is not a literal']
	},
	{
		name: 'the aliased component with a static missing key',
		file: 'alias-static.svelte',
		source: [
			'<script lang="ts">',
			"\timport { T as Label } from '@tolgee/svelte';",
			'</script>',
			'<Label keyName="missing.through_alias" />'
		],
		problems: [
			'alias-static.svelte:4 missing.through_alias: missing.through_alias is not in en.json'
		]
	},
	{
		name: 'a nested conditional',
		file: 'nested.svelte',
		source: [
			'<script lang="ts">',
			IMPORT_TRANSLATE,
			DECLARE_TRANSLATE,
			'\tlet { open, copied }: { open: boolean; copied: boolean } = $props();',
			'</script>',
			"<span>{$t(open ? (copied ? 'aria.copied' : 'aria.copy') : 'aria.sidebar')}</span>"
		],
		problems: [
			"nested.svelte:6 open ? (copied ? 'aria.copied' : 'aria.copy') : 'aria.sidebar': the key is not a literal"
		]
	},
	{
		name: 'the store passed as a prop',
		file: 'prop.svelte',
		source: [
			'<script lang="ts">',
			IMPORT_TRANSLATE,
			"\timport Child from './child.svelte';",
			DECLARE_TRANSLATE,
			'</script>',
			'<Child translate={t} />'
		],
		problems: [`prop.svelte:6 t: ${OUTSIDE_LOOKUP}`]
	},
	{
		name: 'a destructuring under another name',
		file: 'renamed.svelte',
		source: [
			'<script lang="ts">',
			IMPORT_TRANSLATE,
			'\tconst { t: translate } = getTranslate();',
			"\tconst label = translate('aria.copy');",
			'</script>',
			"<span>{label} {$translate('missing.renamed')}</span>"
		],
		problems: [
			`renamed.svelte:4 translate: ${OUTSIDE_LOOKUP}`,
			"renamed.svelte:6 'missing.renamed': missing.renamed is not in en.json"
		]
	},
	{
		name: 'a subscription to the store',
		file: 'subscribe.svelte',
		source: [
			'<script lang="ts">',
			IMPORT_TRANSLATE,
			DECLARE_TRANSLATE,
			"\tlet label = $state('');",
			"\tt.subscribe((translate) => (label = translate('aria.copy')));",
			'</script>',
			'<span>{label}</span>'
		],
		problems: [`subscribe.svelte:5 t: ${OUTSIDE_LOOKUP}`]
	},
	{
		name: 'a spread onto the component',
		file: 'spread.svelte',
		source: [
			'<script lang="ts">',
			"\timport { T } from '@tolgee/svelte';",
			'\tlet props: { keyName: string } = $props();',
			'</script>',
			'<T {...props} />'
		],
		problems: ['spread.svelte:5 T: the props of the Tolgee component are spread']
	},
	{
		name: 'the component passed on as a value',
		file: 'value.svelte',
		source: [
			'<script lang="ts">',
			"\timport { T as Label } from '@tolgee/svelte';",
			"\timport Child from './child.svelte';",
			'</script>',
			'<Child as={Label} />'
		],
		problems: [`value.svelte:5 Label: ${OUTSIDE_LOOKUP}`]
	},
	{
		name: 'a store declared in the module script',
		file: 'module.svelte',
		source: [
			'<script module lang="ts">',
			IMPORT_TRANSLATE,
			'\tconst { t: shared } = getTranslate();',
			'</script>',
			'<script lang="ts">',
			"\timport { get } from 'svelte/store';",
			"\tconst label = get(shared)('aria.copy');",
			'</script>',
			'<span>{label}</span>'
		],
		problems: [`module.svelte:7 shared: ${OUTSIDE_LOOKUP}`]
	},
	{
		name: 'a re-export of the translation API',
		file: 'reexport.ts',
		source: [
			"import { getTranslate } from '@tolgee/svelte';",
			'export { getTranslate };',
			'export const { t } = getTranslate();',
			"export { T } from '@tolgee/svelte';"
		],
		problems: [
			`reexport.ts:2 getTranslate: ${OUTSIDE_LOOKUP}`,
			`reexport.ts:3 getTranslate: ${OUTSIDE_LOOKUP}`,
			"reexport.ts:4 '@tolgee/svelte': the module re-exports the Tolgee API"
		]
	},
	{
		name: 'a store called without the prefix in TypeScript',
		file: 'direct.svelte.ts',
		source: [
			"import { getTranslate } from '@tolgee/svelte';",
			'const { t } = getTranslate();',
			"export const label = t('missing.untranslated');"
		],
		problems: [`direct.svelte.ts:3 t: ${OUTSIDE_LOOKUP}`]
	},
	{
		name: 'a literal fallback behind a dynamic key',
		file: 'fallback.svelte',
		source: [
			'<script lang="ts">',
			IMPORT_TRANSLATE,
			DECLARE_TRANSLATE,
			'\tlet { fromApp }: { fromApp: string } = $props();',
			'</script>',
			"<span>{$t(fromApp || 'common.cancel')}</span>"
		],
		problems: ["fallback.svelte:6 fromApp || 'common.cancel': the key is not a literal"]
	},
	{
		name: 'a template-literal keyName with a substitution',
		file: 'template.svelte',
		source: [
			'<script lang="ts">',
			"\timport { T } from '@tolgee/svelte';",
			'\tlet { which }: { which: string } = $props();',
			'</script>',
			'<T keyName={`common.${which}`} />'
		],
		problems: ['template.svelte:5 `common.${which}`: the key is not a literal']
	},
	{
		name: 'literal keys of the store',
		file: 'literal.svelte',
		source: [
			'<script lang="ts">',
			IMPORT_TRANSLATE,
			DECLARE_TRANSLATE,
			'</script>',
			"<span>{$t('common.cancel')} {$t(`aria.copy`)}</span>"
		],
		problems: []
	},
	{
		name: 'both branches of a conditional',
		file: 'conditional.svelte',
		source: [
			'<script lang="ts">',
			IMPORT_TRANSLATE,
			DECLARE_TRANSLATE,
			'\tlet { copied }: { copied: boolean } = $props();',
			'</script>',
			"<span aria-label={$t(copied ? 'aria.copied' : 'aria.copy')}></span>"
		],
		problems: []
	},
	{
		name: 'literal keyNames of the component under its name and an alias',
		file: 'component.svelte',
		source: [
			'<script lang="ts">',
			"\timport { T, T as Label } from '@tolgee/svelte';",
			'</script>',
			'<T keyName="aria.copy" />',
			'<T keyName={`common.cancel`} />',
			"<Label keyName={'aria.close'} />"
		],
		problems: []
	},
	{
		name: 'a local t beside the store',
		file: 'shadow.svelte',
		source: [
			'<script lang="ts">',
			IMPORT_TRANSLATE,
			DECLARE_TRANSLATE,
			'\tconst width = (t: string) => t.length;',
			'\tlet { items }: { items: string[] } = $props();',
			'</script>',
			'{#each items as t}<span>{width(t)}</span>{/each}',
			"<span>{$t('aria.copy')}</span>"
		],
		problems: []
	},
	{
		name: 'a module-script t beside the instance store with a dynamic missing key',
		file: 'module-shadow-dynamic.svelte',
		source: [
			MODULE_SCRIPT,
			"\tconst t = 'a distinct module binding';",
			'</script>',
			'<script lang="ts">',
			IMPORT_TRANSLATE,
			DECLARE_TRANSLATE,
			"\tconst missingFromApp = 'missing.through_shadow';",
			'</script>',
			'<span>{$t(missingFromApp)}</span>'
		],
		problems: ['module-shadow-dynamic.svelte:9 missingFromApp: the key is not a literal']
	},
	{
		name: 'a module-script t beside the instance store with a missing key in a conditional',
		file: 'module-shadow-conditional.svelte',
		source: [
			MODULE_SCRIPT,
			"\tconst t = 'a distinct module binding';",
			'</script>',
			'<script lang="ts">',
			IMPORT_TRANSLATE,
			DECLARE_TRANSLATE,
			'</script>',
			"<span>{$t(true ? 'aria.copy' : 'missing.through_shadow_branch')}</span>"
		],
		problems: [
			"module-shadow-conditional.svelte:8 true ? 'aria.copy' : 'missing.through_shadow_branch': missing.through_shadow_branch is not in en.json"
		]
	},
	{
		name: 'a module-script store used in the template',
		file: 'module-store.svelte',
		source: [
			MODULE_SCRIPT,
			IMPORT_TRANSLATE,
			DECLARE_TRANSLATE,
			'</script>',
			"<span>{$t('missing.module_store')}</span>"
		],
		problems: [
			"module-store.svelte:5 'missing.module_store': missing.module_store is not in en.json"
		]
	},
	{
		name: 'an instance store that shadows a module-script Tolgee store',
		file: 'instance-shadow.svelte',
		source: [
			MODULE_SCRIPT,
			IMPORT_TRANSLATE,
			DECLARE_TRANSLATE,
			'</script>',
			'<script lang="ts">',
			"\timport { readable } from 'svelte/store';",
			'\tlet { fromApp }: { fromApp: string } = $props();',
			'\tconst t = readable((key: string) => key);',
			'</script>',
			'<span>{$t(fromApp)}</span>'
		],
		problems: []
	},
	{
		name: 'a module script with unrelated declarations beside a permitted lookup',
		file: 'module-unrelated.svelte',
		source: [
			MODULE_SCRIPT,
			"\texport const sizes = ['sm', 'lg'] as const;",
			"\tconst label = 'unrelated';",
			'</script>',
			'<script lang="ts">',
			IMPORT_TRANSLATE,
			DECLARE_TRANSLATE,
			'</script>',
			"<span title={label}>{$t('aria.copy')} {sizes.length}</span>"
		],
		problems: []
	},
	{
		name: 'a type query of the component beside a literal keyName',
		file: 'type-query.svelte',
		source: TYPE_QUERY,
		problems: []
	},
	{
		name: 'a type query of the component beside a value use of it',
		file: 'type-value.svelte',
		source: [
			...TYPE_QUERY.slice(0, -2),
			'\tconst Label = TranslationLabel;',
			...TYPE_QUERY.slice(-2)
		],
		problems: [`type-value.svelte:6 TranslationLabel: ${OUTSIDE_LOOKUP}`]
	}
] as const;

const FIXTURE_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'primitive-keys-'));

describe('Tolgee keys of the primitives', () => {
	afterAll(() => fs.rmSync(FIXTURE_ROOT, { recursive: true, force: true }));

	it.each(FIXTURES)('reports $name', ({ file, source, problems }) => {
		const directory = fs.mkdtempSync(path.join(FIXTURE_ROOT, 'case-'));
		fs.writeFileSync(path.join(directory, file), source.join('\n'));
		expect(scan(directory, directory).problems).toEqual(problems);
	});

	it('finds every key of the primitives in the English catalog', () => {
		const { problems, keys } = scan(PRIMITIVES, process.cwd());
		expect(problems).toEqual([]);
		expect(keys.size).toBeGreaterThan(15);
	});
});
