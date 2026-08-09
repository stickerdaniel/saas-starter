/**
 * Enumerate the function surface a Convex tree publishes.
 *
 * Read off Convex's own generated `api` and `internal` types rather than
 * re-derived from the sources, because every re-derivation drifts. An earlier
 * version walked the tree and classified exports itself, and each review round
 * found another way it disagreed with Convex: component directories counted as
 * root api, a nested `_generated` skipped, `schema.ts` and multi-dot names
 * included, `.cjs` modules whose named exports Convex never emits, files whose
 * only module statements sit behind a comment, and marker-shaped objects that
 * Convex's conditional types reject. All of those are answered here for free.
 *
 * `_generated/api.d.ts` bakes in the module list, which is what the CLI decided
 * to bundle, so the entry-point rules are already applied. The function set is
 * computed from that list at type-check time through `ApiFromModules` and
 * `FilterApi`, so it always reflects the current sources: deleting an export
 * removes it here even if nobody re-ran codegen. Kind and visibility come out
 * of the `FunctionReference<kind, visibility, ...>` leaf, and `components`
 * stays outside `api` exactly as it does for a caller.
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

/**
 * Diagnostics that can turn a live registration into `any` and drop it out of
 * the surface unnoticed.
 *
 * The baseline tree is type-checked against the *current* `node_modules`, so a
 * commit that upgrades a dependency past a builder it used to export would
 * otherwise erase the promise that builder made, and the removal it ships in
 * the same commit would pass. Narrowed to module resolution and export
 * existence on purpose: an ordinary type error elsewhere still yields the
 * declared registration type, and failing on all of them would make an old
 * baseline unusable for reasons that cannot hide a deletion.
 */
const ERASING_DIAGNOSTICS = new Set([
	2305, // Module '...' has no exported member '...'
	2306, // File '...' is not a module
	2307, // Cannot find module '...'
	2614 // Module '...' has no exported member '...' (did you mean default?)
]);

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

/** `api.admin.queries.listUsers` -> `admin/queries:listUsers`. */
function identifierOf(pathSegments: string[]): string | null {
	if (pathSegments.length < 2) return null;
	const fn = pathSegments[pathSegments.length - 1]!;
	return `${pathSegments.slice(0, -1).join('/')}:${fn}`;
}

export function surfaceOf(convexRoot: string): Surface {
	const entry = path.join(convexRoot, '_generated/api.d.ts');
	if (!existsSync(entry)) {
		throw new Error(`convex-surface: ${entry} is missing, so nothing states what is published`);
	}
	const options = compilerOptions(convexRoot);
	const program = ts.createProgram([entry], options);

	const erasing = program
		.getSemanticDiagnostics()
		.filter((diagnostic) => ERASING_DIAGNOSTICS.has(diagnostic.code));
	if (erasing.length > 0) {
		const shown = erasing.slice(0, 10).map((diagnostic) => {
			const where = diagnostic.file
				? `${path.relative(convexRoot, diagnostic.file.fileName)}: `
				: '';
			return `${where}${ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ')}`;
		});
		throw new Error(
			`convex-surface: imports do not resolve, refusing to enumerate a surface with holes:\n  ${shown.join('\n  ')}${
				erasing.length > shown.length ? `\n  (+${erasing.length - shown.length} more)` : ''
			}`
		);
	}

	const checker = program.getTypeChecker();
	const source = program.getSourceFile(entry);
	if (!source) throw new Error(`convex-surface: could not read ${entry}`);
	const moduleSymbol = checker.getSymbolAtLocation(source);
	if (!moduleSymbol) throw new Error(`convex-surface: ${entry} is not a module`);

	const surface: Surface = new Map();
	const leaf = /^FunctionReference<"(query|mutation|action)", "(public|internal)"/;

	const walk = (type: ts.Type, segments: string[], depth: number): void => {
		// Convex nests one level per directory; the real tree is three or four
		// deep, and the bound keeps a recursive type from running away.
		if (depth > 12) return;
		const match = leaf.exec(checker.typeToString(type));
		if (match) {
			const identifier = identifierOf(segments);
			if (identifier) {
				surface.set(identifier, {
					kind: match[1] as Kind,
					visibility: match[2] as Visibility
				});
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
