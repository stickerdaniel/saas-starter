/**
 * Enumerate the function surface a Convex tree publishes.
 *
 * Asked of the type checker rather than of the text, because the text lies in
 * both directions. A commented-out `export const old = mutation(` reads as a
 * live function and would wave a deletion through, and an alias
 * `export const old = newName` has no call to match at all. The checker sees
 * the registered type through aliases, re-exports and wrappers like
 * `authedMutation(...)`.
 *
 * The registration is read structurally, off the marker properties Convex
 * itself filters by (`isConvexFunction`, one of `isMutation`/`isQuery`/
 * `isAction`, and `isPublic` or `isInternal` — see convex/server's
 * registration types and the generated-API filter). Matching the printed type
 * name was tried first and lies in both directions too: a named type alias
 * prints as the alias and hid a real function, while an object that merely
 * contains a registered function printed the marker type and counted as one.
 */

import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

export type Visibility = 'public' | 'internal';
export type Kind = 'mutation' | 'query' | 'action';
export type Registration = { kind: Kind; visibility: Visibility };
/** identifier -> how it is published, e.g. `daphne/processMaps:editPlan`. */
export type Surface = Map<string, Registration>;

export function registrationOf(type: ts.Type, checker: ts.TypeChecker): Registration | null {
	// A union publishes a function only if every constituent publishes the same
	// one; `RegisteredMutation | { disabled: true }` is not callable by Convex,
	// and neither is `RegisteredMutation | undefined` — under the Convex
	// project's own strictness, ApiFromModules omits that export entirely.
	if (type.isUnion()) {
		const parts = type.types.map((part) => registrationOf(part, checker));
		const first = parts[0];
		if (!first) return null;
		return parts.every(
			(part) => part && part.kind === first.kind && part.visibility === first.visibility
		)
			? first
			: null;
	}
	// A marker only counts when its type is the literal `true`, the same test
	// Convex's generated-API filter applies (`extends true`). Mere presence
	// would accept `{ isConvexFunction: false, ... }`, which is not callable.
	const marker = (name: string): boolean => {
		const property = type.getProperty(name);
		if (!property) return false;
		return checker.typeToString(checker.getTypeOfSymbol(property)) === 'true';
	};
	if (!marker('isConvexFunction')) return null;
	const kinds: Kind[] = [];
	if (marker('isMutation')) kinds.push('mutation');
	if (marker('isQuery')) kinds.push('query');
	if (marker('isAction')) kinds.push('action');
	if (kinds.length !== 1) return null;
	const isPublic = marker('isPublic');
	const isInternal = marker('isInternal');
	if (isPublic === isInternal) return null;
	return { kind: kinds[0]!, visibility: isPublic ? 'public' : 'internal' };
}

// The extension family Convex itself bundles as entry points; a mutation in a
// `.mts` file is published like any other, and skipping it here would make its
// later deletion pass vacuously. Declaration files and tests publish nothing.
const ENTRY_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'];

export function isEntryFile(name: string): boolean {
	if (/\.d\.[mc]?ts$/.test(name)) return false;
	if (/\.(test|spec)\.[a-z]+$/.test(name)) return false;
	return ENTRY_EXTENSIONS.some((extension) => name.endsWith(extension));
}

function convexFiles(dir: string): string[] {
	const out: string[] = [];
	for (const entry of readdirSync(dir)) {
		if (entry === '_generated') continue;
		const full = path.join(dir, entry);
		if (statSync(full).isDirectory()) out.push(...convexFiles(full));
		else if (isEntryFile(entry)) out.push(full);
	}
	return out;
}

/** Strip the entry extension: `daphne/foo.mts` -> `daphne/foo`. */
function moduleNameOf(convexRoot: string, file: string): string {
	return path.relative(convexRoot, file).replace(/\.[a-z]+$/, '');
}

export function surfaceOf(convexRoot: string): Surface {
	const files = convexFiles(convexRoot);
	const program = ts.createProgram(files, {
		allowJs: true,
		noEmit: true,
		skipLibCheck: true,
		target: ts.ScriptTarget.ESNext,
		module: ts.ModuleKind.ESNext,
		moduleResolution: ts.ModuleResolutionKind.Bundler,
		// The Convex project compiles strict; without this, `Registered* |
		// undefined` collapses to the bare registration and a conditionally
		// disabled export would read as still published.
		strict: true
	});
	const checker = program.getTypeChecker();
	const surface: Surface = new Map();
	for (const file of files) {
		const source = program.getSourceFile(file);
		if (!source) continue;
		const symbol = checker.getSymbolAtLocation(source);
		if (!symbol) continue;
		const moduleName = moduleNameOf(convexRoot, file);
		for (const exportSymbol of checker.getExportsOfModule(symbol)) {
			const resolved =
				exportSymbol.flags & ts.SymbolFlags.Alias
					? checker.getAliasedSymbol(exportSymbol)
					: exportSymbol;
			const declaration = resolved.valueDeclaration ?? resolved.declarations?.[0];
			if (!declaration) continue;
			const registration = registrationOf(
				checker.getTypeOfSymbolAtLocation(resolved, declaration),
				checker
			);
			if (!registration) continue;
			surface.set(`${moduleName}:${exportSymbol.getName()}`, registration);
		}
	}
	return surface;
}
