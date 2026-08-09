/**
 * Enumerate the function surface a Convex tree publishes.
 *
 * Read Convex's generated `api` and `internal` types directly because every
 * source-level reimplementation drifts. An earlier version walked the tree and
 * classified exports itself. Successive reviews found component boundaries,
 * skipped files, module syntax, and marker-shaped values where it disagreed
 * with Convex. The generated types already answer those questions.
 *
 * `_generated/api.d.ts` contains the module list selected by the CLI. Its
 * `ApiFromModules` and `FilterApi` types compute the callable function set from
 * the current source exports. Kind and visibility come from each
 * `FunctionReference<kind, visibility, ...>` leaf, while `components` stays
 * outside `api` exactly as it does for a caller.
 *
 * A historical tree must execute this reader from a checkout with its own
 * frozen install. Conditional types supplied by Convex or another package can
 * change a registration's kind or remove it without producing `any` or a
 * diagnostic.
 */

import { existsSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

export type Visibility = 'public' | 'internal';
export type Kind = 'mutation' | 'query' | 'action';
export type Registration = { kind: Kind; visibility: Visibility };
/** identifier -> how it is published, e.g. `users:viewer`. */
export type Surface = Map<string, Registration>;

// The extension family Convex bundles as entry points. Only the consumer scan
// needs it now: which of these files the backend publishes is api.d.ts's answer.
export const ENTRY_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'];

function compilerOptions(convexRoot: string): ts.CompilerOptions {
	const configPath = path.join(convexRoot, 'tsconfig.json');
	if (!existsSync(configPath)) {
		throw new Error(`convex-surface: no tsconfig.json in ${convexRoot}`);
	}
	const read = ts.readConfigFile(configPath, ts.sys.readFile);
	if (read.error) {
		throw new Error(
			`convex-surface: ${ts.flattenDiagnosticMessageText(read.error.messageText, ' ')}`
		);
	}
	const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, convexRoot);
	// A config that only half-parses would silently compile under defaults, and
	// the surface it produced would be a guess.
	if (parsed.errors.length > 0) {
		throw new Error(
			`convex-surface: ${configPath} did not parse:\n  ${parsed.errors
				.map((error) => ts.flattenDiagnosticMessageText(error.messageText, ' '))
				.join('\n  ')}`
		);
	}
	return { ...parsed.options, noEmit: true, skipLibCheck: true };
}

/** `api.daphne.processMaps.editPlan` -> `users:viewer`. */
function identifierOf(pathSegments: string[]): string | null {
	if (pathSegments.length < 2) return null;
	const fn = pathSegments[pathSegments.length - 1]!;
	return `${pathSegments.slice(0, -1).join('/')}:${fn}`;
}

export function surfaceOf(
	convexRoot: string,
	protectedIdentifiers: ReadonlySet<string> = new Set()
): Surface {
	const entry = path.join(convexRoot, '_generated/api.d.ts');
	if (!existsSync(entry)) {
		throw new Error(`convex-surface: ${entry} is missing, so nothing states what is published`);
	}
	const options = compilerOptions(convexRoot);
	const program = ts.createProgram([entry], options);
	const checker = program.getTypeChecker();
	const source = program.getSourceFile(entry);
	if (!source) throw new Error(`convex-surface: could not read ${entry}`);
	const moduleSymbol = checker.getSymbolAtLocation(source);
	if (!moduleSymbol) throw new Error(`convex-surface: ${entry} is not a module`);

	// TypeScript has many ways to recover an invalid registration as `any`
	// (missing export, property, callable signature, or identifier). Inspect the
	// value exports that correspond to functions the deployed consumer actually
	// referenced and fail on the effect itself. Unrelated framework adapters may
	// intentionally export any (Autumn does in the starter), so failing every any
	// in the tree would turn a focused compatibility guard into a second global
	// type-check.
	const erasedPromises: string[] = [];
	for (const statement of source.statements) {
		if (!ts.isImportDeclaration(statement) || !statement.importClause?.namedBindings) continue;
		if (!ts.isNamespaceImport(statement.importClause.namedBindings)) continue;
		if (!ts.isStringLiteral(statement.moduleSpecifier)) continue;
		const moduleName = statement.moduleSpecifier.text
			.replace(/^\.\.\//, '')
			.replace(/\.[^.]+$/, '');
		const promisedHere = [...protectedIdentifiers].filter((identifier) =>
			identifier.startsWith(`${moduleName}:`)
		);
		if (promisedHere.length === 0) continue;
		const alias = checker.getSymbolAtLocation(statement.importClause.namedBindings.name);
		if (!alias) {
			erasedPromises.push(...promisedHere);
			continue;
		}
		const imported = checker.getAliasedSymbol(alias);
		const exports = checker.getExportsOfModule(imported);
		for (const identifier of promisedHere) {
			const exportName = identifier.slice(moduleName.length + 1);
			const exported = exports.find((candidate) => candidate.getName() === exportName);
			const declaration = exported?.valueDeclaration ?? exported?.declarations?.[0];
			if (!exported || !declaration) continue;
			// A named re-export has an ExportSpecifier declaration and no
			// valueDeclaration. Reading only the latter skipped exactly the alias form
			// expand-contract encourages when its upstream value drifted to any.
			const type = checker.getTypeOfSymbolAtLocation(exported, declaration);
			if (type.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) {
				erasedPromises.push(identifier);
			}
		}
	}
	if (erasedPromises.length > 0) {
		throw new Error(
			`convex-surface: protected value exports became any or unknown, refusing to let dependency drift erase them:\n  ${[
				...new Set(erasedPromises)
			].join('\n  ')}`
		);
	}

	const surface: Surface = new Map();
	const leaf = /^FunctionReference<"(query|mutation|action)", "(public|internal)"/;
	const referenceFields = ['_type', '_visibility', '_args', '_returnType', '_componentPath'];
	const isReferenceConstituent = (type: ts.Type): boolean =>
		referenceFields.every((field) => checker.getPropertyOfType(type, field) !== undefined);

	const protectsBelow = (segments: string[]): boolean => {
		if (segments.length === 0) return protectedIdentifiers.size > 0;
		const prefix = segments.join('/');
		return [...protectedIdentifiers].some(
			(identifier) => identifier.startsWith(`${prefix}/`) || identifier.startsWith(`${prefix}:`)
		);
	};

	const walk = (type: ts.Type, segments: string[], depth: number): void => {
		// Convex has no module nesting limit. A bound remains as a cycle guard, but
		// exceeding it is a hard failure: silently returning would erase a valid
		// deep promise from the baseline.
		if (depth > 100) {
			throw new Error(`convex-surface: api type nesting exceeded 100 at ${segments.join('.')}`);
		}
		if (
			protectsBelow(segments) &&
			(type.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown) ||
				checker.getIndexInfoOfType(type, ts.IndexKind.String))
		) {
			throw new Error(
				`convex-surface: protected api branch became any, unknown, or string-indexed at ${segments.join('.') || '<root>'}`
			);
		}
		const match = leaf.exec(checker.typeToString(type));
		if (match) {
			const identifier = identifierOf(segments);
			if (identifier) {
				surface.set(identifier, {
					kind: match[1] as Kind,
					visibility: match[2] as Visibility
				});
			}
			// A node can be both a function and a namespace (`foo.ts` exports bar,
			// `foo/bar.ts` exports baz). Split the intersection and walk only its
			// namespace constituents. Filtering marker *names* is unsafe: `_type`,
			// `_args`, and the other markers are also valid Convex module segments.
			if (type.isIntersection()) {
				for (const constituent of type.types) {
					if (!isReferenceConstituent(constituent)) {
						walk(constituent, segments, depth + 1);
					}
				}
			}
			return;
		}
		for (const property of checker.getPropertiesOfType(type)) {
			walk(checker.getTypeOfSymbol(property), [...segments, property.getName()], depth + 1);
		}
	};

	for (const exported of checker.getExportsOfModule(moduleSymbol)) {
		// `components` is deliberately absent: a component's functions live in
		// their own namespace and are not callable through `api`.
		if (exported.getName() !== 'api' && exported.getName() !== 'internal') continue;
		const declaration = exported.valueDeclaration ?? exported.declarations?.[0];
		if (!declaration) continue;
		walk(checker.getTypeOfSymbolAtLocation(exported, declaration), [], 0);
	}
	if (surface.size === 0) {
		throw new Error(`convex-surface: ${entry} published no functions, which cannot be right`);
	}
	return surface;
}

if (import.meta.main) {
	const convexRoot = process.argv[2];
	if (!convexRoot) throw new Error('convex-surface: expected the Convex root path');
	const protectedIdentifiers = new Set<string>(
		JSON.parse(process.env.CONVEX_SURFACE_PROTECTED_IDENTIFIERS ?? '[]') as string[]
	);
	process.stdout.write(JSON.stringify([...surfaceOf(convexRoot, protectedIdentifiers)]));
}
