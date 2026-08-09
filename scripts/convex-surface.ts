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

import { existsSync, readdirSync, statSync } from 'node:fs';
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
	// The markers ARE the whole structure of Registered* (no call signature to
	// demand), so a hand-written marker-shaped object still counts here even
	// though Convex's conditional types reject it. That over-approximation
	// only errs conservatively: it can add a promise and block a deletion,
	// never wave one through.
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
// later deletion pass vacuously.
export const ENTRY_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'];

/**
 * Mirrors the bundler's entryPoints() filter (convex/src/bundler/index.ts):
 * dotfiles, emacs tempfiles, `schema.ts`/`schema.js`, anything with more than
 * one dot (`auth.config.ts`, `convex.config.ts`, `*.test.ts`, `*.d.ts`), and
 * paths containing a space publish nothing.
 */
export function isEntryFile(name: string): boolean {
	const base = path.basename(name);
	if (base.startsWith('.') || base.startsWith('#')) return false;
	if (base === 'schema.ts' || base === 'schema.js') return false;
	if ((base.match(/\./g) ?? []).length > 1) return false;
	if (name.includes(' ')) return false;
	return ENTRY_EXTENSIONS.some((extension) => name.endsWith(extension));
}

function convexFiles(dir: string, root: string = dir): string[] {
	const out: string[] = [];
	for (const entry of readdirSync(dir)) {
		// Only the root _generated is codegen output the bundler skips; a nested
		// one (emails/_generated) is ordinary published code and stays in.
		if (entry === '_generated' && dir === root) continue;
		const full = path.join(dir, entry);
		if (statSync(full).isDirectory()) {
			// A nested directory with a convex.config.ts is a component: Convex
			// deploys it into its own namespace and removes its functions from the
			// root api, so counting them here would keep a promise the root never
			// made. The root's own convex.config.ts (the app definition) does not
			// end the walk, because the walk starts below it.
			if (existsSync(path.join(full, 'convex.config.ts'))) continue;
			out.push(...convexFiles(full, root));
		} else if (isEntryFile(entry)) out.push(full);
	}
	return out;
}

/** Strip the entry extension, with forward slashes on every platform:
 *  `daphne/foo.mts` -> `daphne/foo`. */
function moduleNameOf(convexRoot: string, file: string): string {
	return path
		.relative(convexRoot, file)
		.split(path.sep)
		.join('/')
		.replace(/\.[a-z]+$/, '');
}

/**
 * The Convex tree's own tsconfig when it has one, so `types`, `jsx`, and
 * strictness match what `check:convex` compiles. The fallback keeps `strict`
 * on: without it, `Registered* | undefined` collapses to the bare registration
 * and a conditionally disabled export would read as still published.
 */
function compilerOptionsFor(convexRoot: string): ts.CompilerOptions {
	const configPath = path.join(convexRoot, 'tsconfig.json');
	if (existsSync(configPath)) {
		const read = ts.readConfigFile(configPath, ts.sys.readFile);
		if (!read.error) {
			const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, convexRoot);
			return { ...parsed.options, noEmit: true, skipLibCheck: true };
		}
	}
	return {
		allowJs: true,
		noEmit: true,
		skipLibCheck: true,
		target: ts.ScriptTarget.ESNext,
		module: ts.ModuleKind.ESNext,
		moduleResolution: ts.ModuleResolutionKind.Bundler,
		strict: true
	};
}

/**
 * Every package import in the tree must resolve, or the surface is refused
 * outright.
 *
 * An unresolvable import types its bindings as `any`, and an `any`-typed
 * registration silently drops out of the surface. On a baseline checkout that
 * is exactly the dependency-migration hazard: a commit that removes the
 * package the old builders came from (resolution runs against the current
 * node_modules) would erase the promise those builders made, and the check
 * would pass vacuously. Checked by resolving specifiers directly instead of
 * asking for full semantic diagnostics, which would cost a second type-check
 * of the whole tree.
 *
 * Only bare specifiers are held to this. `node:` builtins resolve through the
 * ambient lib, not through module resolution, and a relative import may point
 * at a generated file (`./convex-env`, `./_generated/index.js`) that a git
 * checkout legitimately does not contain; neither is where a removed
 * dependency hides.
 */
function assertPackageImportsResolve(
	program: ts.Program,
	files: string[],
	options: ts.CompilerOptions
): void {
	const unresolved = new Set<string>();
	for (const file of files) {
		const source = program.getSourceFile(file);
		if (!source) continue;
		ts.forEachChild(source, (node) => {
			const specifier =
				(ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
				node.moduleSpecifier &&
				ts.isStringLiteral(node.moduleSpecifier)
					? node.moduleSpecifier.text
					: null;
			if (!specifier) return;
			if (specifier.startsWith('.') || specifier.startsWith('node:')) return;
			if (!ts.resolveModuleName(specifier, file, options, ts.sys).resolvedModule) {
				unresolved.add(`${specifier} (from ${file})`);
			}
		});
	}
	if (unresolved.size > 0) {
		throw new Error(
			`convex-surface: unresolvable package imports, refusing to enumerate a surface with holes:\n  ${[...unresolved].join('\n  ')}`
		);
	}
}

export function surfaceOf(convexRoot: string): Surface {
	const files = convexFiles(convexRoot);
	const options = compilerOptionsFor(convexRoot);
	const program = ts.createProgram(files, options);
	assertPackageImportsResolve(program, files, options);
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
