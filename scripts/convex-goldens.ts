import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Spec } from '@confect/core';
import typescript from 'typescript';
import { GOLDENS_DIR, digest, type Json } from '../src/lib/confect/goldens';
import { workingTreeScheduledTargets } from './convex-consumer-compat';
import { freshSurfaceOf, type Kind, type Surface, type Visibility } from './convex-surface';

import ts = typescript;

export const API_TYPES_FIXTURE = `${GOLDENS_DIR}/_generated/apiTypes.ts`;
const CONVEX_ROOT = 'src/lib/convex';
const SPEC_MODULE = 'src/lib/confect/_generated/spec.ts';
const CONVEX_TSCONFIG = `${CONVEX_ROOT}/tsconfig.json`;
const AUTHORED_ENTRY_FILES = new Set([
	'schema.ts',
	'http.ts',
	'crons.ts',
	'auth.config.ts',
	'convex.config.ts'
]);
const IMPORTER_ROOTS = ['src', 'scripts', 'e2e'];
const IMPORTER_EXTENSIONS = ['.ts', '.mts', '.cts', '.js', '.mjs', '.cjs', '.svelte'];
const SKIPPED_DIRECTORIES = new Set(['node_modules', '_generated', '__fixtures__']);
const SOURCE_ALIASES: ReadonlyArray<readonly [string, string]> = [
	['$lib/', 'src/lib/'],
	['#lib/', 'src/lib/']
];
export type SpecFunction = {
	group: string;
	name: string;
	kind: Kind;
	visibility: Visibility;
	runtime: string;
	provenance: string;
};

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
	return typeof value === 'object' && value !== null;
}

function field(value: unknown, ...keys: readonly string[]): unknown {
	let current = value;
	for (const key of keys) {
		if (!isRecord(current)) return undefined;
		current = current[key];
	}
	return current;
}

function text(value: unknown, what: string): string {
	if (typeof value !== 'string') throw new Error(`convex-goldens: ${what} is not a string`);
	return value;
}

function isKind(value: string): value is Kind {
	return value === 'query' || value === 'mutation' || value === 'action';
}

function isVisibility(value: string): value is Visibility {
	return value === 'public' || value === 'internal';
}

function specFunctionsOf(group: unknown, groupPath: string): SpecFunction[] {
	const functions = field(group, 'functions');
	const groups = field(group, 'groups');
	if (!isRecord(functions) || !isRecord(groups)) {
		throw new Error(`convex-goldens: ${groupPath || 'the spec root'} is not a group spec`);
	}
	const own = Object.entries(functions).map(([name, spec]): SpecFunction => {
		const where = `${groupPath}:${name}`;
		const kind = text(field(spec, 'runtimeAndFunctionType', 'functionType'), `${where} kind`);
		const visibility = text(field(spec, 'functionVisibility'), `${where} visibility`);
		if (!isKind(kind) || !isVisibility(visibility)) {
			throw new Error(`convex-goldens: ${where} is a ${visibility} ${kind}`);
		}
		return {
			group: groupPath,
			name: text(field(spec, 'name'), `${where} name`),
			kind,
			visibility,
			runtime: text(field(spec, 'runtimeAndFunctionType', 'runtime'), `${where} runtime`),
			provenance: text(field(spec, 'functionProvenance', '_tag'), `${where} provenance`)
		};
	});
	return [
		...own,
		...Object.entries(groups).flatMap(([name, child]) =>
			specFunctionsOf(child, groupPath === '' ? name : `${groupPath}/${name}`)
		)
	];
}

export async function specInventory(root = process.cwd()) {
	const module: unknown = await import(pathToFileURL(path.resolve(root, SPEC_MODULE)).href);
	const spec = field(module, 'default');
	if (!Spec.isSpec(spec)) throw new Error(`convex-goldens: ${SPEC_MODULE} exports no spec`);
	const functions = specFunctionsOf({ functions: {}, groups: Spec.groups(spec) }, '').sort((a, b) =>
		compare(`${a.group}:${a.name}`, `${b.group}:${b.name}`)
	);
	return functions;
}

export function inventoryGolden(
	functions: readonly SpecFunction[],
	consumedNativeExports: readonly ConsumedExport[]
): Json {
	const groups: Record<string, Record<string, readonly string[]>> = {};
	for (const { group, name, visibility, kind, runtime, provenance } of functions) {
		groups[group] = { ...groups[group], [name]: [visibility, kind, runtime, provenance] };
	}
	return {
		digest: digest(groups),
		columns: ['visibility', 'kind', 'runtime', 'provenance'],
		groups,
		consumedNativeExports
	};
}

export async function scheduledTargets() {
	const surface = await freshSurfaceOf(CONVEX_ROOT);
	const { references, unresolved } = workingTreeScheduledTargets();
	const targets = [...new Set(references.map(({ identifier }) => identifier))]
		.sort(compare)
		.map((identifier) => {
			const registration = surface.get(identifier);
			return registration
				? `${identifier} ${registration.visibility} ${registration.kind}`
				: `${identifier} unpublished`;
		});
	return {
		targets,
		unresolved: unresolved.map(({ file, expression }) => `${file} ${expression}`)
	};
}

export type ConsumedExport = { module: string; export: string; importer: string };

type ModuleImport = { specifier: string; names: readonly string[] };

function compare(a: string, b: string): number {
	return a < b ? -1 : a > b ? 1 : 0;
}

function filesBelow(root: string, directory: string, accept: (file: string) => boolean): string[] {
	const absolute = path.resolve(root, directory);
	return readdirSync(absolute, { recursive: true, encoding: 'utf8' })
		.map((relative) => relative.split(path.sep).join('/'))
		.filter(
			(relative) =>
				!relative.split('/').some((segment) => SKIPPED_DIRECTORIES.has(segment)) &&
				accept(relative) &&
				statSync(path.join(absolute, relative)).isFile()
		)
		.map((relative) => `${directory}/${relative}`)
		.sort(compare);
}

function scriptText(file: string, source: string): string {
	if (!file.endsWith('.svelte')) return source;
	return [...source.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script\b[^>]*>/gi)]
		.map((match) => match[1])
		.join('\n');
}

function stringArgument(node: ts.CallExpression): string | undefined {
	const [first] = node.arguments;
	return first && ts.isStringLiteralLike(first) ? first.text : undefined;
}

function importsOf(file: string, source: string): ModuleImport[] {
	const sourceFile = ts.createSourceFile(file, scriptText(file, source), ts.ScriptTarget.Latest);
	const found: ModuleImport[] = [];
	const visit = (node: ts.Node): void => {
		if (
			(ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
			node.moduleSpecifier &&
			ts.isStringLiteral(node.moduleSpecifier)
		) {
			found.push({ specifier: node.moduleSpecifier.text, names: importedNames(node) });
		} else if (
			ts.isCallExpression(node) &&
			node.expression.kind === ts.SyntaxKind.ImportKeyword &&
			stringArgument(node) !== undefined
		) {
			found.push({ specifier: stringArgument(node)!, names: ['*'] });
		} else if (
			ts.isImportTypeNode(node) &&
			ts.isLiteralTypeNode(node.argument) &&
			ts.isStringLiteral(node.argument.literal)
		) {
			found.push({ specifier: node.argument.literal.text, names: ['*'] });
		}
		ts.forEachChild(node, visit);
	};
	visit(sourceFile);
	return found;
}

function importedNames(node: ts.ImportDeclaration | ts.ExportDeclaration): string[] {
	if (ts.isExportDeclaration(node)) {
		if (!node.exportClause || ts.isNamespaceExport(node.exportClause)) return ['*'];
		return node.exportClause.elements.map((element) => (element.propertyName ?? element.name).text);
	}
	const clause = node.importClause;
	if (!clause) return [];
	const names = clause.name ? ['default'] : [];
	const bindings = clause.namedBindings;
	if (bindings && ts.isNamespaceImport(bindings)) return [...names, '*'];
	for (const element of bindings?.elements ?? []) {
		names.push((element.propertyName ?? element.name).text);
	}
	return names;
}

function exportedNames(file: string, source: string): string[] {
	const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest);
	const names: string[] = [];
	for (const statement of sourceFile.statements) {
		if (ts.isExportDeclaration(statement)) {
			if (!statement.exportClause) {
				throw new Error(
					`convex-goldens: ${file} forwards ${statement.getText(sourceFile)}, whose names cannot be inventoried`
				);
			}
			if (ts.isNamespaceExport(statement.exportClause)) {
				names.push(statement.exportClause.name.text);
				continue;
			}
			names.push(...statement.exportClause.elements.map((element) => element.name.text));
			continue;
		}
		if (ts.isExportAssignment(statement)) {
			names.push('default');
			continue;
		}
		const modifiers = ts.canHaveModifiers(statement) ? ts.getModifiers(statement) : undefined;
		if (!modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)) continue;
		if (modifiers.some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword)) {
			names.push('default');
		} else if (ts.isVariableStatement(statement)) {
			for (const declaration of statement.declarationList.declarations) {
				names.push(...bindingNames(declaration.name));
			}
		} else if (
			(ts.isFunctionDeclaration(statement) ||
				ts.isClassDeclaration(statement) ||
				ts.isEnumDeclaration(statement) ||
				ts.isInterfaceDeclaration(statement) ||
				ts.isTypeAliasDeclaration(statement)) &&
			statement.name
		) {
			names.push(statement.name.text);
		}
	}
	return names;
}

function bindingNames(name: ts.BindingName): string[] {
	if (ts.isIdentifier(name)) return [name.text];
	return name.elements.flatMap((element) =>
		ts.isOmittedExpression(element) ? [] : bindingNames(element.name)
	);
}

function resolveSpecifier(root: string, importer: string, specifier: string): string | undefined {
	const alias = SOURCE_ALIASES.find(([prefix]) => specifier.startsWith(prefix));
	const base = alias
		? path.resolve(root, alias[1], specifier.slice(alias[0].length))
		: specifier.startsWith('.')
			? path.resolve(root, path.dirname(importer), specifier)
			: undefined;
	if (base === undefined) return undefined;
	const relative = path.relative(root, base).split(path.sep).join('/');
	return relative.replace(/\.(js|ts)$/, '');
}

export function consumedNativeExports(
	registrations: ReadonlyMap<string, ReadonlySet<string>>,
	root = process.cwd()
): ConsumedExport[] {
	const nonRegistrations = new Map<string, Set<string>>();
	for (const file of filesBelow(
		root,
		CONVEX_ROOT,
		(relative) =>
			relative.endsWith('.ts') && !relative.endsWith('.d.ts') && !AUTHORED_ENTRY_FILES.has(relative)
	)) {
		const module = file.slice(CONVEX_ROOT.length + 1, -'.ts'.length);
		const registered = registrations.get(module) ?? new Set<string>();
		const names = exportedNames(file, readFileSync(path.resolve(root, file), 'utf8'));
		nonRegistrations.set(
			`${CONVEX_ROOT}/${module}`,
			new Set(names.filter((name) => !registered.has(name)))
		);
	}
	const consumed: ConsumedExport[] = [];
	for (const importer of IMPORTER_ROOTS.flatMap((directory) =>
		filesBelow(root, directory, (relative) =>
			IMPORTER_EXTENSIONS.some((extension) => relative.endsWith(extension))
		)
	)) {
		for (const { specifier, names } of importsOf(
			importer,
			readFileSync(path.resolve(root, importer), 'utf8')
		)) {
			const target = resolveSpecifier(root, importer, specifier);
			const candidates = target === undefined ? undefined : nonRegistrations.get(target);
			if (!target || !candidates || target === importer.replace(/\.ts$/, '')) continue;
			const module = target.slice(CONVEX_ROOT.length + 1);
			for (const name of names.includes('*') ? [...candidates] : names) {
				if (candidates.has(name)) consumed.push({ module, export: name, importer });
			}
		}
	}
	return consumed.sort((a, b) =>
		compare(`${a.module}:${a.export}:${a.importer}`, `${b.module}:${b.export}:${b.importer}`)
	);
}

function functionReference(identifier: string, visibility: Visibility): string {
	const [module = '', name = ''] = identifier.split(':');
	return `typeof ${visibility === 'public' ? 'api' : 'internal'}.${[...module.split('/'), name].join('.')}`;
}

function convexCompilerOptions(root: string): ts.CompilerOptions {
	const configFile = ts.readConfigFile(path.resolve(root, CONVEX_TSCONFIG), ts.sys.readFile);
	return ts.parseJsonConfigFileContent(configFile.config, ts.sys, path.resolve(root, CONVEX_ROOT))
		.options;
}

const API_TYPES_HEADER = [
	"import type { FunctionReference, FunctionType, FunctionVisibility } from 'convex/server';",
	"import type { api, internal } from '../../../convex/_generated/api';",
	'',
	'type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;',
	'type Expect<T extends true> = T;',
	"type Golden<F extends FunctionReference<FunctionType, FunctionVisibility>> = [F['_type'], F['_visibility'], F['_args'], F['_returnType']];",
	''
];

export async function apiTypeFixture(root = process.cwd()): Promise<string> {
	const surface: Surface = await freshSurfaceOf(path.resolve(root, CONVEX_ROOT));
	const functions = [...surface].sort(([a], [b]) => compare(a, b));
	const fixture = path.resolve(root, API_TYPES_FIXTURE);
	const probe = [
		...API_TYPES_HEADER,
		...functions.flatMap(([identifier, { visibility }], index) => [
			`type GoldenArgs${index} = (${functionReference(identifier, visibility)})['_args'];`,
			`type GoldenReturns${index} = (${functionReference(identifier, visibility)})['_returnType'];`
		])
	].join('\n');
	const options = convexCompilerOptions(root);
	const host = ts.createCompilerHost(options);
	const isFixture = (fileName: string) => path.resolve(fileName) === fixture;
	const { fileExists, readFile, getSourceFile } = host;
	host.fileExists = (fileName) => isFixture(fileName) || fileExists(fileName);
	host.readFile = (fileName) => (isFixture(fileName) ? probe : readFile(fileName));
	host.getSourceFile = (fileName, languageVersion, ...rest) =>
		isFixture(fileName)
			? ts.createSourceFile(fileName, probe, languageVersion, true)
			: getSourceFile(fileName, languageVersion, ...rest);
	const program = ts.createProgram([fixture], options, host);
	const checker = program.getTypeChecker();
	const sourceFile = program.getSourceFile(fixture);
	if (!sourceFile) throw new Error(`convex-goldens: could not compile ${API_TYPES_FIXTURE}`);
	const printed = new Map<string, string>();
	for (const statement of sourceFile.statements) {
		if (!ts.isTypeAliasDeclaration(statement) || !statement.name.text.startsWith('Golden'))
			continue;
		printed.set(
			statement.name.text,
			checker.typeToString(
				checker.getTypeAtLocation(statement.name),
				statement,
				ts.TypeFormatFlags.NoTruncation |
					ts.TypeFormatFlags.InTypeAlias |
					ts.TypeFormatFlags.UseSingleQuotesForStringLiteralType
			)
		);
	}
	const assertions = functions.map(([identifier, { kind, visibility }], index) => {
		const args = printed.get(`GoldenArgs${index}`);
		const returns = printed.get(`GoldenReturns${index}`);
		if (args === undefined || returns === undefined) {
			throw new Error(`convex-goldens: no type for ${identifier}`);
		}
		return `\tExpect<Equal<Golden<${functionReference(identifier, visibility)}>, ['${kind}', '${visibility}', ${args}, ${returns}]>>`;
	});
	return [
		...API_TYPES_HEADER,
		'export type ApiTypeGoldens = [',
		assertions.join(',\n'),
		'];',
		''
	].join('\n');
}

export function apiTypeFixtureIdentifiers(source: string): string[] {
	return [...source.matchAll(/Golden<typeof (?:api|internal)\.([\w.]+)>/g)]
		.map((match) => {
			const segments = match[1]!.split('.');
			return `${segments.slice(0, -1).join('/')}:${segments.at(-1)}`;
		})
		.sort(compare);
}

if (import.meta.main) {
	writeFileSync(API_TYPES_FIXTURE, await apiTypeFixture());
	console.log(`convex-goldens: wrote ${API_TYPES_FIXTURE}`);
}
