import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import typescript from 'typescript';

import { ENTRY_EXTENSIONS, type Surface, type Visibility } from './convex-surface';

// Vite rewrites every use of an imported name into a read off the import
// object, and Vitest wraps a CommonJS package such as `typescript` in a Proxy
// for default interop. Under `import ts from 'typescript'`, each `ts.isX` in
// the syntax walks below runs a Proxy trap. The alias reads the Proxy once, at
// load, and still names the types.
import ts = typescript;

// App sources contribute direct and namespace-adapter references. Backend source,
// the functions directory and the helpers beside it, contributes scheduler targets
// because persisted runAfter/runAt jobs outlive the deployment that created them.
export type BackendPaths = {
	readonly convexRoot: string;
	readonly confectRoot: string;
	readonly convexApiModule: string;
	readonly confectRefsModule: string;
};

export function backendPaths(convexRoot: string): BackendPaths {
	const confectRoot = path.posix.join(path.posix.dirname(convexRoot), 'confect');
	return {
		convexRoot,
		confectRoot,
		convexApiModule: `${convexRoot}/_generated/api`,
		confectRefsModule: `${confectRoot}/_generated/refs`
	};
}

export function schedulerRoots(backend: BackendPaths): string[] {
	return [backend.convexRoot, backend.confectRoot];
}

function isBelow(file: string, root: string): boolean {
	return file.startsWith(`${root}/`);
}

export function isSchedulerModule(file: string, backend: BackendPaths): boolean {
	return schedulerRoots(backend).some((root) => isBelow(file, root));
}

export type Reference = { identifier: string; visibility: Visibility; file: string };
export type NamespaceReference = { prefix: string; visibility: Visibility; file: string };
type UnresolvedTarget = { file: string; line: number; expression: string };
type ScheduledTargets = {
	references: Reference[];
	unresolved: UnresolvedTarget[];
	unverifiedApiImports: UnresolvedTarget[];
};
export type ConsumerSource = { file: string; source: string };
export type ConsumerReferences = {
	references: Reference[];
	namespaces: NamespaceReference[];
	unresolved: UnresolvedTarget[];
};

/** `api.users.viewer` -> `users:viewer`. */
export function identifiersIn(source: string, file: string): Reference[] {
	const found: Reference[] = [];
	// Convex's backend validates function names and module path segments as ASCII
	// alphanumerics plus underscores. Generated TypeScript types accept more names,
	// but `$` and Unicode exports cannot reach a deployed surface.
	const pattern = /\b(api|internal)\.((?:[A-Za-z0-9_]+\.)+[A-Za-z0-9_]+)/g;
	for (const match of source.matchAll(pattern)) {
		const parts = match[2]!.split('.');
		const fn = parts.pop()!;
		if (parts.length === 0) continue;
		found.push({
			identifier: `${parts.join('/')}:${fn}`,
			visibility: match[1] === 'api' ? 'public' : 'internal',
			file
		});
	}
	return found;
}

/** `(api as any).autumn` -> every function published below `autumn`. */
export function namespaceReferencesIn(source: string, file: string): NamespaceReference[] {
	const found: NamespaceReference[] = [];
	const pattern = /\((api|internal)\s+as\s+any\)\.((?:[A-Za-z0-9_]+\.)*[A-Za-z0-9_]+)/g;
	for (const match of source.matchAll(pattern)) {
		found.push({
			prefix: match[2]!.replaceAll('.', '/'),
			visibility: match[1] === 'api' ? 'public' : 'internal',
			file
		});
	}
	return found;
}

function unwrapExpression(expression: ts.Expression): ts.Expression {
	let current = expression;
	while (
		ts.isParenthesizedExpression(current) ||
		ts.isAsExpression(current) ||
		ts.isTypeAssertionExpression(current) ||
		ts.isSatisfiesExpression(current) ||
		ts.isNonNullExpression(current)
	) {
		current = current.expression;
	}
	return current;
}

type TargetRoot =
	| { kind: 'convex'; visibility: Visibility }
	| { kind: 'confectRefs' }
	| { kind: 'functionReference'; identifier: string };
type TargetPath = { root: TargetRoot; segments: readonly string[] };

const SCHEDULING_METHODS: ReadonlySet<string> = new Set(['runAfter', 'runAt']);
const RESOLUTION_DEPTH = 32;

function convexRoot(name: string): TargetPath | null {
	if (name === 'api') return { root: { kind: 'convex', visibility: 'public' }, segments: [] };
	if (name === 'internal')
		return { root: { kind: 'convex', visibility: 'internal' }, segments: [] };
	return null;
}

function functionIdentifier(segments: readonly string[]): string | null {
	return segments.length < 2 ? null : `${segments.slice(0, -1).join('/')}:${segments.at(-1)}`;
}

function referencesOf({ root, segments }: TargetPath, file: string): Reference[] | null {
	switch (root.kind) {
		case 'convex': {
			const identifier = functionIdentifier(segments);
			return identifier ? [{ identifier, visibility: root.visibility, file }] : null;
		}
		case 'confectRefs': {
			const [visibility, ...groupPath] = segments;
			if (visibility !== 'public' && visibility !== 'internal') return null;
			const identifier = functionIdentifier(groupPath);
			return identifier ? [{ identifier, visibility, file }] : null;
		}
		case 'functionReference':
			// makeFunctionReference does not encode visibility at runtime. Both candidates
			// stay here; the baseline surface keeps only the one actually published.
			return segments.length > 0
				? null
				: [
						{ identifier: root.identifier, visibility: 'public', file },
						{ identifier: root.identifier, visibility: 'internal', file }
					];
	}
}

function importsModule(file: string, specifier: string, module: string): boolean {
	if (!specifier.startsWith('.')) return false;
	const resolved = path.posix.join(path.posix.dirname(file), specifier);
	return resolved.replace(/\.[cm]?[jt]s$/, '') === module;
}

function isConstDeclaration(declaration: ts.VariableDeclaration): boolean {
	return (
		ts.isVariableDeclarationList(declaration.parent) &&
		(declaration.parent.flags & ts.NodeFlags.Const) !== 0
	);
}

function singleFileChecker(sourceFile: ts.SourceFile): ts.TypeChecker {
	const host: ts.CompilerHost = {
		getSourceFile: () => sourceFile,
		getDefaultLibFileName: () => 'lib.d.ts',
		writeFile: () => {},
		getCurrentDirectory: () => '',
		getCanonicalFileName: (fileName) => fileName,
		useCaseSensitiveFileNames: () => true,
		getNewLine: () => '\n',
		fileExists: (fileName) => fileName === sourceFile.fileName,
		readFile: () => undefined
	};
	return ts
		.createProgram({
			rootNames: [sourceFile.fileName],
			options: { allowJs: true, noLib: true, noResolve: true, types: [] },
			host
		})
		.getTypeChecker();
}

function memberName(expression: ts.Expression): string | undefined {
	if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
	if (
		ts.isElementAccessExpression(expression) &&
		ts.isStringLiteralLike(expression.argumentExpression)
	) {
		return expression.argumentExpression.text;
	}
	return undefined;
}

function isMakeFunctionReferenceCall(expression: ts.Expression): expression is ts.CallExpression {
	return (
		ts.isCallExpression(expression) &&
		ts.isIdentifier(expression.expression) &&
		expression.expression.text === 'makeFunctionReference'
	);
}

function isTopLevelDeclaration(declaration: ts.VariableDeclaration): boolean {
	return (
		ts.isVariableDeclarationList(declaration.parent) &&
		ts.isVariableStatement(declaration.parent.parent) &&
		ts.isSourceFile(declaration.parent.parent.parent)
	);
}

function bindingKey(element: ts.BindingElement): string | undefined {
	const key = element.propertyName ?? element.name;
	return ts.isIdentifier(key) || ts.isStringLiteral(key) ? key.text : undefined;
}

function scheduledCallResolver(sourceFile: ts.SourceFile, file: string, backend: BackendPaths) {
	let checker: ts.TypeChecker | undefined;

	const declarationOf = (identifier: ts.Identifier): ts.Declaration | undefined => {
		checker ??= singleFileChecker(sourceFile);
		const declarations = checker.getSymbolAtLocation(identifier)?.declarations ?? [];
		return declarations.length === 1 ? declarations[0] : undefined;
	};

	const importedPath = (
		declaration: ts.ImportDeclaration | ts.JSDocImportTag,
		name: string
	): TargetPath | null => {
		if (!ts.isStringLiteral(declaration.moduleSpecifier)) return null;
		const specifier = declaration.moduleSpecifier.text;
		if (name === 'default') {
			return importsModule(file, specifier, backend.confectRefsModule)
				? { root: { kind: 'confectRefs' }, segments: [] }
				: null;
		}
		return importsModule(file, specifier, backend.convexApiModule) ? convexRoot(name) : null;
	};

	const bindingPath = (element: ts.BindingElement, depth: number): TargetPath | null => {
		if (element.dotDotDotToken || element.initializer) return null;
		if (!ts.isObjectBindingPattern(element.parent)) return null;
		const key = bindingKey(element);
		if (key === undefined) return null;
		const owner = element.parent.parent;
		const base = ts.isBindingElement(owner)
			? bindingPath(owner, depth + 1)
			: ts.isVariableDeclaration(owner) && isConstDeclaration(owner) && owner.initializer
				? resolve(owner.initializer, depth + 1)
				: null;
		return base && { root: base.root, segments: [...base.segments, key] };
	};

	const declarationPath = (identifier: ts.Identifier, depth: number): TargetPath | null => {
		const declaration = declarationOf(identifier);
		if (!declaration) return null;
		if (ts.isImportClause(declaration)) return importedPath(declaration.parent, 'default');
		if (ts.isImportSpecifier(declaration)) {
			return importedPath(
				declaration.parent.parent.parent,
				(declaration.propertyName ?? declaration.name).text
			);
		}
		if (ts.isVariableDeclaration(declaration)) {
			if (!ts.isIdentifier(declaration.name) || !declaration.initializer) return null;
			const followed =
				isConstDeclaration(declaration) ||
				(isTopLevelDeclaration(declaration) &&
					isMakeFunctionReferenceCall(unwrapExpression(declaration.initializer)));
			return followed ? resolve(declaration.initializer, depth + 1) : null;
		}
		if (ts.isBindingElement(declaration)) return bindingPath(declaration, depth + 1);
		return null;
	};

	const resolve = (expression: ts.Expression, depth: number): TargetPath | null => {
		if (depth > RESOLUTION_DEPTH) return null;
		const current = unwrapExpression(expression);
		if (ts.isPropertyAccessExpression(current) || ts.isElementAccessExpression(current)) {
			const member = memberName(current);
			if (member === undefined) return null;
			const base = resolve(current.expression, depth + 1);
			return base && { root: base.root, segments: [...base.segments, member] };
		}
		if (ts.isIdentifier(current)) return declarationPath(current, depth + 1);
		if (isMakeFunctionReferenceCall(current)) {
			const [identifier] = current.arguments;
			if (!identifier || !ts.isStringLiteralLike(identifier)) return null;
			if (!/^(?:[A-Za-z0-9_]+\/)*[A-Za-z0-9_]+:[A-Za-z0-9_]+$/.test(identifier.text)) return null;
			return { root: { kind: 'functionReference', identifier: identifier.text }, segments: [] };
		}
		return null;
	};

	const isSchedulingAlias = (identifier: ts.Identifier, depth = 0): boolean => {
		if (depth > RESOLUTION_DEPTH) return false;
		const declaration = declarationOf(identifier);
		if (!declaration) return false;
		if (ts.isVariableDeclaration(declaration)) {
			if (!isConstDeclaration(declaration) || !declaration.initializer) return false;
			const initializer = unwrapExpression(declaration.initializer);
			if (ts.isIdentifier(initializer)) return isSchedulingAlias(initializer, depth + 1);
			const member = memberName(initializer);
			return member !== undefined && SCHEDULING_METHODS.has(member);
		}
		if (ts.isBindingElement(declaration)) {
			const key = bindingKey(declaration);
			return key !== undefined && SCHEDULING_METHODS.has(key);
		}
		return false;
	};

	return {
		isSchedulingCallee: (callee: ts.Expression): boolean => {
			const current = unwrapExpression(callee);
			if (ts.isIdentifier(current)) {
				return SCHEDULING_METHODS.has(current.text) || isSchedulingAlias(current);
			}
			const member = memberName(current);
			return member !== undefined && SCHEDULING_METHODS.has(member);
		},
		resolveTarget: (target: ts.Expression): Reference[] | null => {
			const resolved = resolve(target, 0);
			return resolved && referencesOf(resolved, file);
		},
		importsApiRoot: (target: ts.Expression): boolean => {
			let current = unwrapExpression(target);
			while (ts.isPropertyAccessExpression(current) || ts.isElementAccessExpression(current)) {
				current = unwrapExpression(current.expression);
			}
			if (!ts.isIdentifier(current)) return false;
			const declaration = declarationOf(current);
			return (
				declaration !== undefined &&
				ts.isImportSpecifier(declaration) &&
				convexRoot((declaration.propertyName ?? declaration.name).text) !== null
			);
		}
	};
}

export function scheduledIdentifiersIn(
	source: string,
	file: string,
	backend: BackendPaths
): ScheduledTargets {
	const references: Reference[] = [];
	const unresolved: UnresolvedTarget[] = [];
	const unverifiedApiImports: UnresolvedTarget[] = [];
	const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
	const { isSchedulingCallee, resolveTarget, importsApiRoot } = scheduledCallResolver(
		sourceFile,
		file,
		backend
	);
	const visit = (node: ts.Node): void => {
		if (ts.isCallExpression(node) && isSchedulingCallee(node.expression)) {
			const [, target] = node.arguments;
			const spread = node.arguments.slice(0, 2).some((argument) => ts.isSpreadElement(argument));
			if (target || spread) {
				const resolved = target && !spread ? resolveTarget(target) : null;
				if (resolved) references.push(...resolved);
				else {
					const subject = target ?? node;
					const entry = {
						file,
						line: sourceFile.getLineAndCharacterOfPosition(subject.getStart(sourceFile)).line + 1,
						expression: subject.getText(sourceFile).replace(/\s+/g, ' ')
					};
					unresolved.push(entry);
					if (target && !spread && importsApiRoot(target)) unverifiedApiImports.push(entry);
				}
			}
		}
		ts.forEachChild(node, visit);
	};
	visit(sourceFile);
	return { references, unresolved, unverifiedApiImports };
}

export function expandNamespaceReferences(
	namespaces: NamespaceReference[],
	surface: Surface
): Reference[] {
	const found: Reference[] = [];
	for (const namespace of namespaces) {
		const parts = namespace.prefix.split('/');
		const directIdentifier =
			parts.length < 2 ? null : `${parts.slice(0, -1).join('/')}:${parts.at(-1)}`;
		for (const [identifier, registration] of surface) {
			if (registration.visibility !== namespace.visibility) continue;
			if (
				identifier === directIdentifier ||
				identifier.startsWith(`${namespace.prefix}:`) ||
				identifier.startsWith(`${namespace.prefix}/`)
			) {
				found.push({ identifier, visibility: namespace.visibility, file: namespace.file });
			}
		}
	}
	return found;
}

// Any deployed source can hold a reference, so this stays wide: declarations
// and tests are out (tests run against the working tree, not production).
// Which of the referenced functions the backend actually published is the
// surface's answer, not this filter's.
export function isConsumerSource(line: string): boolean {
	if (/\.d\.[mc]?ts$/.test(line) || /\.(test|spec)\.[a-z]+$/.test(line)) return false;
	return line.endsWith('.svelte') || ENTRY_EXTENSIONS.some((extension) => line.endsWith(extension));
}

export function workingTreeSources(root: string): ConsumerSource[] {
	if (!existsSync(root)) return [];
	return readdirSync(root, { recursive: true, encoding: 'utf8' })
		.map((relative) => path.join(root, relative).split(path.sep).join('/'))
		.filter((file) => isConsumerSource(file) && statSync(file).isFile())
		.sort()
		.map((file) => ({ file, source: readFileSync(file, 'utf8') }));
}

export function workingTreeScheduledTargets(
	backend: BackendPaths
): Pick<ConsumerReferences, 'references' | 'unresolved'> {
	return consumerReferencesIn(
		schedulerRoots(backend).flatMap((root) => workingTreeSources(root)),
		backend
	);
}

export function consumerReferencesIn(
	sources: readonly ConsumerSource[],
	backend: BackendPaths
): ConsumerReferences {
	const references: Reference[] = [];
	const namespaces: NamespaceReference[] = [];
	const unresolved: UnresolvedTarget[] = [];
	for (const { file, source } of sources) {
		if (isSchedulerModule(file, backend)) {
			const scheduled = scheduledIdentifiersIn(source, file, backend);
			references.push(...scheduled.references);
			unresolved.push(
				...(isBelow(file, backend.confectRoot)
					? scheduled.unresolved
					: scheduled.unverifiedApiImports)
			);
			continue;
		}
		references.push(...identifiersIn(source, file));
		namespaces.push(...namespaceReferencesIn(source, file));
	}
	return { references, namespaces, unresolved };
}

// A reference only counts if the baseline actually delivered it the way the
// consumer asked (public through `api.`, internal through `internal.`): one
// that did not match was broken or noise already.
export function requiredReferences(
	consumers: Pick<ConsumerReferences, 'references' | 'namespaces'>,
	promised: Surface
): Reference[] {
	return [
		...consumers.references,
		...expandNamespaceReferences(consumers.namespaces, promised)
	].filter((ref) => promised.get(ref.identifier)?.visibility === ref.visibility);
}

export function brokenReferences(
	required: readonly Reference[],
	promised: Surface,
	available: Surface
): Reference[] {
	return required.filter((ref) => {
		const was = promised.get(ref.identifier)!;
		const now = available.get(ref.identifier);
		return !now || now.kind !== was.kind || now.visibility !== ref.visibility;
	});
}
