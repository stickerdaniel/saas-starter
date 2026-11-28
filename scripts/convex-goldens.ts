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
const SKIPPED_DIRECTORIES = new Set(['node_modules', '_generated', '__fixtures__']);
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

export function inventoryGolden(functions: readonly SpecFunction[]): Json {
	const groups: Record<string, Record<string, readonly string[]>> = {};
	for (const { group, name, visibility, kind, runtime, provenance } of functions) {
		groups[group] = { ...groups[group], [name]: [visibility, kind, runtime, provenance] };
	}
	return {
		digest: digest(groups),
		columns: ['visibility', 'kind', 'runtime', 'provenance'],
		groups
	};
}

export function scheduledTargets(surface: Surface) {
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

export function orphanedExports(
	registrations: ReadonlyMap<string, ReadonlySet<string>>,
	root = process.cwd()
): string[] {
	return filesBelow(
		root,
		CONVEX_ROOT,
		(relative) => relative.endsWith('.ts') && !relative.endsWith('.d.ts')
	).flatMap((file) => {
		const relative = file.slice(CONVEX_ROOT.length + 1);
		const module = relative.slice(0, -'.ts'.length);
		const allowed = AUTHORED_ENTRY_FILES.has(relative)
			? new Set(['default'])
			: (registrations.get(module) ?? new Set<string>());
		return exportedNames(file, readFileSync(path.resolve(root, file), 'utf8'))
			.filter((name) => !allowed.has(name))
			.map((name) => `${CONVEX_ROOT}/${module}:${name}`);
	});
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
	const flags =
		ts.TypeFormatFlags.NoTruncation |
		ts.TypeFormatFlags.InTypeAlias |
		ts.TypeFormatFlags.UseSingleQuotesForStringLiteralType;
	const installedAlias = (modulePath: string, name: string): string => {
		const file = `${path.resolve(path.dirname(fixture), modulePath)}.d.ts`;
		const declaration = program
			.getSourceFile(ts.sys.realpath?.(file) ?? file)
			?.statements.find(
				(statement): statement is ts.TypeAliasDeclaration =>
					ts.isTypeAliasDeclaration(statement) &&
					statement.name.text === name &&
					statement.typeParameters === undefined
			);
		if (!declaration) {
			throw new Error(`convex-goldens: cannot print ${name} of ${modulePath} without its path`);
		}
		return checker.typeToString(checker.getTypeAtLocation(declaration.name), declaration, flags);
	};
	const withoutInstallPaths = (type: string): string => {
		const structural = type.replace(
			/import\("([^"]*\/node_modules\/[^"]*)"\)\.(\w+)/g,
			(_, modulePath: string, name: string) => installedAlias(modulePath, name)
		);
		return structural === type ? type : withoutInstallPaths(structural);
	};
	const printed = new Map<string, string>();
	for (const statement of sourceFile.statements) {
		if (!ts.isTypeAliasDeclaration(statement) || !statement.name.text.startsWith('Golden'))
			continue;
		printed.set(
			statement.name.text,
			withoutInstallPaths(
				checker.typeToString(checker.getTypeAtLocation(statement.name), statement, flags)
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
