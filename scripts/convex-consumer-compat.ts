/**
 * Refuse to remove a Convex function that deployed app code still calls.
 *
 * `scripts/deploy.ts` pushes Convex functions before the SvelteKit build
 * exists, so on an existing deployment every deploy has a window in which the
 * previous app code runs against the new backend, and browser tabs stretch
 * that window indefinitely: the version poll only reloads on the next
 * navigation, so a tab that never navigates keeps calling with its old
 * bundle. A platform rollback widens it further, because it restores old app
 * code while Convex has no function versioning, no aliases and no deployment
 * rollback to restore the surface that code was built against. Previews are
 * outside this reasoning: `--preview-create` recreates the backend, so a
 * stale preview bundle points at a deleted deployment either way. See issue
 * https://github.com/stickerdaniel/saas-starter/issues/789.
 *
 * First ship the new name while keeping the old one published exactly as it
 * was (`export const old = newName` is enough). Server aliases can be removed
 * once no running or rollback-restorable build references them. A scheduled
 * target must also remain until every pending job carrying its old path has run
 * or been cancelled; `runAt` can make that horizon unbounded. Browser aliases
 * have no automatic expiry because a tab can stay open indefinitely. Deleting
 * either kind needs separate evidence that nothing supported can call it. This
 * check enforces the compatibility release and does not supply that later
 * evidence. Every function the app referenced at the baseline commit must still
 * be published with the same name, kind and visibility. The baseline comes from
 * git, which prevents the commit that removes a function from blessing its own
 * removal.
 *
 * The check is an incomplete lower bound. Direct app references and namespace
 * adapters are read as text, so a reference through a renamed import, bracket
 * notation, or a dynamically assembled value does not register. It reliably
 * catches the common case: a rename done in one commit across both sides.
 * Persisted scheduler targets in backend source use the TypeScript syntax tree
 * and follow local bindings. Under `src/lib/confect`, a `runAfter` or `runAt`
 * target that does not resolve to a function path fails the check. Under
 * `src/lib/convex`, so does a target rooted in an `api` or `internal` import
 * from a module other than the generated api.
 */

import { execFileSync, spawn } from 'node:child_process';
import {
	copyFileSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	realpathSync,
	renameSync,
	rmSync,
	statSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import typescript from 'typescript';

import {
	ENTRY_EXTENSIONS,
	freshSurfaceOf,
	type Registration,
	type Surface,
	type Visibility
} from './convex-surface';
import { isolatedGitEnv, sanitizedGitEnv } from './git-context';

// Vite rewrites every use of an imported name into a read off the import
// object, and Vitest wraps a CommonJS package such as `typescript` in a Proxy
// for default interop. Under `import ts from 'typescript'`, each `ts.isX` in
// the syntax walks below runs a Proxy trap. The alias reads the Proxy once, at
// load, and still names the types.
import ts = typescript;

const CONVEX_ROOT = 'src/lib/convex';
const CONFECT_ROOT = 'src/lib/confect';
const CONFECT_REFS_MODULE = `${CONFECT_ROOT}/_generated/refs`;
const CONVEX_API_MODULE = `${CONVEX_ROOT}/_generated/api`;
// App sources contribute direct and namespace-adapter references. Backend source,
// the functions directory and the helpers beside it, contributes scheduler targets
// because persisted runAfter/runAt jobs outlive the deployment that created them.
const BACKEND_ROOTS = [CONVEX_ROOT, CONFECT_ROOT];
const CONSUMER_ROOT = 'src';

export type Reference = { identifier: string; visibility: Visibility; file: string };
export type NamespaceReference = { prefix: string; visibility: Visibility; file: string };
type UnresolvedTarget = { file: string; line: number; expression: string };
type ScheduledTargets = {
	references: Reference[];
	unresolved: UnresolvedTarget[];
	unverifiedApiImports: UnresolvedTarget[];
};
type ConsumerSource = { file: string; source: string };
type ConsumerReferences = {
	references: Reference[];
	namespaces: NamespaceReference[];
	unresolved: UnresolvedTarget[];
};

function git(
	args: string[],
	cwd = process.cwd(),
	hooksPath?: string,
	env = isolatedGitEnv(),
	extraConfiguration: string[] = []
): string {
	// stderr captured, not inherited: a probing rev-parse is allowed to fail
	// without printing git's `fatal:` above this script's own explanation. The exact
	// checkout remains usable when its owner differs from the process uid.
	const configuration = ['-c', `safe.directory=${realpathSync(cwd)}`, ...extraConfiguration];
	if (hooksPath) configuration.unshift('-c', `core.hooksPath=${hooksPath}`);
	return execFileSync('git', [...configuration, ...args], {
		cwd,
		encoding: 'utf8',
		env,
		maxBuffer: 32 * 1024 * 1024,
		stdio: ['ignore', 'pipe', 'pipe']
	});
}

/**
 * The explicit baseline fetch is the transport-requiring call that can safely run outside
 * the isolated environment: it brings objects in and decides no verdict itself. Emptying
 * global and system config also empties `url.*.insteadOf`, credential helpers, proxies and
 * CA settings; measured, a baseline reachable only through an insteadOf rule went unfetched
 * and the check certified the trunk instead. A partial clone can also lazy-fetch during
 * isolated verdict reads; that path fails closed when it needs external transport config and
 * remains part of the materialization boundary tracked in #863.
 */
function gitFetch(args: string[]): string {
	return git(args, process.cwd(), undefined, sanitizedGitEnv());
}

type Baseline = { commit: string } | { root: true } | { unavailable: string } | null;

function resolveBaseline(): Baseline {
	// Set by CI on trunk pushes to the push event's pre-push SHA: a push can
	// carry several commits, and HEAD~1 would let the first of them bless a
	// rename the deployed build never saw. It also points the check at a
	// known-bad commit to prove it catches the failure. An all-zero SHA (branch
	// creation) falls back to the trunk resolution below. A nonzero SHA that
	// cannot be found fails CI instead of falling back, because on a push that
	// happens only after a force push moved the deployed tip out of reach: the
	// state in which HEAD~1 would bless what that tip still calls.
	const override = process.env.CONVEX_COMPAT_BASE?.trim();
	if (override && !/^0+$/.test(override)) {
		try {
			return { commit: git(['rev-parse', '--verify', `${override}^{commit}`]).trim() };
		} catch {
			try {
				gitFetch(['fetch', '--quiet', 'origin', override]);
				return { commit: git(['rev-parse', '--verify', `${override}^{commit}`]).trim() };
			} catch {
				if (process.env.CI) {
					console.error(
						`convex-consumer-compat: CONVEX_COMPAT_BASE=${override} is unreachable (force push?); refusing to guess a baseline for it.`
					);
					process.exit(1);
				}
				console.warn(
					`convex-consumer-compat: CONVEX_COMPAT_BASE=${override} is not a commit here; using the trunk instead.`
				);
			}
		}
	}
	const candidates = ['origin/main', 'main'];
	for (const candidate of candidates) {
		try {
			git(['rev-parse', '--verify', `${candidate}^{commit}`]);
		} catch {
			continue;
		}
		let base: string;
		try {
			// The merge base, not the tip: on a branch that started before an
			// unrelated deletion landed, the tip would demand functions this branch
			// never promised to keep.
			base = git(['merge-base', 'HEAD', candidate]).trim();
		} catch {
			return {
				unavailable:
					'convex-consumer-compat: the branch merge base is unavailable. Fetch the full branch and trunk history before running this check; compatibility cannot be certified against the trunk tip.'
			};
		}
		// On the trunk itself the merge base is HEAD, and a commit would be asked
		// only about the consumer it just rewrote: it would bless its own removal.
		// The parent is the baseline instead (CI pushes land here only when the
		// pre-push SHA above was unusable).
		if (base === git(['rev-parse', 'HEAD']).trim()) {
			try {
				return { commit: git(['rev-parse', 'HEAD~1']).trim() };
			} catch {
				const commitHeaders = git(['cat-file', '-p', 'HEAD']).split(/\r?\n\r?\n/, 1)[0]!;
				const hasParent = /^parent [0-9a-f]+$/m.test(commitHeaders);
				if (!hasParent) return { root: true };
				if (git(['rev-parse', '--is-shallow-repository']).trim() === 'true') {
					return {
						unavailable:
							'convex-consumer-compat: trunk history is shallow. Fetch the full trunk history before running this check; compatibility cannot be certified without the previous deployed commit.'
					};
				}
				return {
					unavailable:
						'convex-consumer-compat: the previous trunk commit is unavailable. Fetch the trunk history before running this check; compatibility cannot be certified without a baseline.'
				};
			}
		}
		return { commit: base };
	}
	return null;
}

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

function scheduledCallResolver(sourceFile: ts.SourceFile, file: string) {
	let checker: ts.TypeChecker | undefined;

	const declarationOf = (identifier: ts.Identifier): ts.Declaration | undefined => {
		checker ??= singleFileChecker(sourceFile);
		const declarations = checker.getSymbolAtLocation(identifier)?.declarations ?? [];
		return declarations.length === 1 ? declarations[0] : undefined;
	};

	const importedPath = (declaration: ts.ImportDeclaration, name: string): TargetPath | null => {
		if (!ts.isStringLiteral(declaration.moduleSpecifier)) return null;
		const specifier = declaration.moduleSpecifier.text;
		if (name === 'default') {
			return importsModule(file, specifier, CONFECT_REFS_MODULE)
				? { root: { kind: 'confectRefs' }, segments: [] }
				: null;
		}
		return importsModule(file, specifier, CONVEX_API_MODULE) ? convexRoot(name) : null;
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

export function scheduledIdentifiersIn(source: string, file: string): ScheduledTargets {
	const references: Reference[] = [];
	const unresolved: UnresolvedTarget[] = [];
	const unverifiedApiImports: UnresolvedTarget[] = [];
	const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
	const { isSchedulingCallee, resolveTarget, importsApiRoot } = scheduledCallResolver(
		sourceFile,
		file
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
function isConsumerSource(line: string): boolean {
	if (/\.d\.[mc]?ts$/.test(line) || /\.(test|spec)\.[a-z]+$/.test(line)) return false;
	return line.endsWith('.svelte') || ENTRY_EXTENSIONS.some((extension) => line.endsWith(extension));
}

/**
 * Every consumer source below `CONSUMER_ROOT` at `commit`, read through one `cat-file --batch`.
 * A `git show` per file cost one process per source: measured 2026-11-03, 982 of them took
 * 22 s on a 24-core host at load 70, a fifth of the time a test had to run this check.
 */
function consumerSourcesAt(commit: string): ConsumerSource[] {
	const entries = git(['ls-tree', '-r', '-z', commit, '--', CONSUMER_ROOT])
		.split('\0')
		.filter(Boolean)
		.map((record) => {
			// `<mode> <type> <object>\t<path>`; the path is the only field that may hold spaces.
			const tab = record.indexOf('\t');
			const [, type, object] = record.slice(0, tab).split(' ');
			return { type, object: object!, file: record.slice(tab + 1) };
		})
		.filter(({ file }) => isConsumerSource(file));
	if (entries.length === 0) return [];
	const output = execFileSync(
		'git',
		['-c', `safe.directory=${realpathSync(process.cwd())}`, 'cat-file', '--batch'],
		{
			env: isolatedGitEnv(),
			input: entries.map(({ object }) => `${object}\n`).join(''),
			maxBuffer: 256 * 1024 * 1024,
			stdio: ['pipe', 'pipe', 'pipe']
		}
	);
	// Each answer is `<object> <type> <size>\n<size bytes>\n`, in request order. Anything else,
	// a gitlink or a `<object> missing` line among them, fails the check.
	const sources: ConsumerSource[] = [];
	let offset = 0;
	for (const entry of entries) {
		const headerEnd = output.indexOf(0x0a, offset);
		const header = output.toString('utf8', offset, headerEnd === -1 ? undefined : headerEnd);
		const [object, type, size] = header.split(' ');
		if (entry.type !== 'blob' || object !== entry.object || type !== 'blob' || !size) {
			throw new Error(
				`convex-consumer-compat: could not read ${entry.file} at ${commit.slice(0, 8)} (${header})`
			);
		}
		const start = headerEnd + 1;
		const end = start + Number(size);
		sources.push({ file: entry.file, source: output.toString('utf8', start, end) });
		offset = end + 1;
	}
	return sources;
}

function workingTreeSources(root: string): ConsumerSource[] {
	if (!existsSync(root)) return [];
	return readdirSync(root, { recursive: true, encoding: 'utf8' })
		.map((relative) => path.join(root, relative).split(path.sep).join('/'))
		.filter((file) => isConsumerSource(file) && statSync(file).isFile())
		.sort()
		.map((file) => ({ file, source: readFileSync(file, 'utf8') }));
}

export function consumerReferencesIn(sources: readonly ConsumerSource[]): ConsumerReferences {
	const references: Reference[] = [];
	const namespaces: NamespaceReference[] = [];
	const unresolved: UnresolvedTarget[] = [];
	for (const { file, source } of sources) {
		if (BACKEND_ROOTS.some((root) => file.startsWith(`${root}/`))) {
			const scheduled = scheduledIdentifiersIn(source, file);
			references.push(...scheduled.references);
			unresolved.push(
				...(file.startsWith(`${CONFECT_ROOT}/`)
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

/** Paths registered by `git worktree list --porcelain -z`. */
export function registeredWorktreePaths(porcelain: string): string[] {
	return porcelain
		.split('\0')
		.filter((record) => record.startsWith('worktree '))
		.map((record) => path.normalize(record.slice('worktree '.length)));
}

function worktreeRegistrationExists(directory: string): boolean {
	return registeredWorktreePaths(git(['worktree', 'list', '--porcelain', '-z'])).includes(
		directory
	);
}

/**
 * Deletes `directory`, a temporary root outside the repository, from a detached child, so
 * the verdict does not wait for it. It is outside the repository, so a late or failed
 * removal changes nothing a later command can read; throwing here would discard an answer
 * the checker already computed and replace the diagnostic that preceded it. The child
 * ignores stdio, so a caller waiting for this process's output does not also wait for the
 * deletion, and runs in the temporary directory, so Bun loads no project `bunfig.toml` or
 * `.env` for it.
 */
function removeAfterExit(directory: string): void {
	const removeNow = (): void => {
		try {
			rmSync(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
		} catch (error) {
			console.error(
				`convex-consumer-compat: could not remove the baseline directory ${directory}: ${
					error instanceof Error ? error.message : String(error)
				}`
			);
		}
	};
	try {
		const child = spawn(
			process.execPath,
			[
				'--eval',
				"require('node:fs').rmSync(process.env.CONVEX_COMPAT_DISCARD, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })"
			],
			{
				cwd: tmpdir(),
				detached: true,
				env: { ...process.env, CONVEX_COMPAT_DISCARD: directory },
				stdio: 'ignore',
				windowsHide: true
			}
		);
		child.on('error', removeNow);
		child.unref();
	} catch {
		removeNow();
	}
}

/**
 * The surface at the baseline commit, from an isolated checkout.
 *
 * The checkout lives outside the current repository so module resolution cannot
 * fall through to today's dependencies. Its frozen install recreates generated
 * artifacts and the dependency types that shaped the deployed API. The current
 * reader is copied into that checkout and executed there, so it also loads the
 * baseline's TypeScript package.
 */
function surfaceAt(commit: string, protectedIdentifiers: ReadonlySet<string>): Surface {
	const tempRoot = mkdtempSync(path.join(tmpdir(), 'convex-compat-'));
	const dir = path.join(tempRoot, 'baseline');
	const hooks = path.join(tempRoot, 'hooks');
	let worktreeAdded = false;
	let registeredDir: string | undefined;
	let cleanupFailure: string | undefined;
	const rememberCleanupFailure = (message: string): void => {
		console.error(message);
		cleanupFailure ??= message;
	};
	let surface: Surface;
	try {
		mkdirSync(hooks);
		// A linked worktree of this repository, not a clone of it. A clone has to reach the
		// baseline commit through a transport, and measured with git 2.55.0 that loses two
		// things this check depends on: a shared clone of a shallow repository writes no
		// `objects/info/alternates`, so a commit only `FETCH_HEAD` reaches disappears, and a
		// shared clone of a partial one borrows the incomplete object store without inheriting
		// `remote.origin.promisor`, so a missing blob can never be fetched. Both fail a
		// baseline the surrounding repository resolved. The empty hook directory suppresses
		// checkout hooks, and the child commands below ignore global and system
		// configuration. A linked worktree still shares repository-local mechanisms:
		// attributes, filters, fsmonitor and install scripts can rewrite its files or shared Git
		// state. Fixing that requires separating materialization from execution, tracked in
		// #863; a partial guard here does not close it.
		//
		// `core.sparseCheckout` is turned off for this one command because a linked worktree
		// inherits it from the shared repository. Measured with git 2.55.0: a checkout whose
		// sparse patterns exclude a directory produces a baseline missing every file under it,
		// and a function deleted from there reads as one that was never published.
		git(['worktree', 'add', '--detach', '--quiet', dir, commit], process.cwd(), hooks, undefined, [
			'-c',
			'core.sparseCheckout=false'
		]);
		worktreeAdded = true;
		registeredDir = realpathSync(dir);
		// The install resolves the baseline lockfile, which may name a Git dependency, so it
		// gets the transport-capable environment for the same reason the baseline fetch does.
		// Baseline package scripts execute here and can change the checkout or its shared Git
		// directory; #863 owns the isolated materialization this function still needs.
		const childEnv = { ...sanitizedGitEnv(), HUSKY: '0' };
		try {
			execFileSync(process.execPath, ['install', '--frozen-lockfile'], {
				cwd: dir,
				encoding: 'utf8',
				env: childEnv,
				maxBuffer: 32 * 1024 * 1024,
				stdio: ['ignore', 'pipe', 'pipe']
			});
		} catch (error) {
			throw new Error(`convex-consumer-compat: could not install baseline ${commit.slice(0, 8)}`, {
				cause: error
			});
		}

		const reader = path.join(dir, '.convex-surface-reader.ts');
		copyFileSync(path.join(process.cwd(), 'scripts/convex-surface.ts'), reader);
		const serialized = execFileSync(process.execPath, [reader, path.join(dir, CONVEX_ROOT)], {
			cwd: dir,
			encoding: 'utf8',
			maxBuffer: 32 * 1024 * 1024,
			stdio: ['ignore', 'pipe', 'pipe'],
			env: {
				...childEnv,
				CONVEX_SURFACE_PROTECTED_IDENTIFIERS: JSON.stringify([...protectedIdentifiers])
			}
		});
		surface = new Map(JSON.parse(serialized) as Array<[string, Registration]>);
	} finally {
		if (worktreeAdded) {
			// Moved aside first, so Git drops only the administrative entry and the install inside
			// is deleted with the temporary root below, after the verdict. Measured 2026-11-03 on
			// a 24-core host at load 70: removing its 84,000 files took 29 s whichever way they
			// were deleted, as long as the install itself. A failed move leaves the checkout for
			// the removal below to delete in place.
			try {
				renameSync(dir, path.join(tempRoot, 'discarded'));
			} catch {
				// Removed in place below.
			}
			try {
				git(['worktree', 'remove', '--force', dir], process.cwd(), hooks);
			} catch {
				// Guarded, because an unguarded throw here escapes the `finally`, replaces the
				// install or surface diagnostic that led here, and skips both the prune below
				// and the temporary-root removal. Windows returns EPERM for a locked dependency
				// file, which is exactly when the Git removal has already failed.
				try {
					rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
				} catch (error) {
					// Recorded, not merely logged. `git worktree prune` returns 0 while the checkout
					// directory still exists, because the registration is still valid, so leaving
					// this to the prune below would end the run successfully with the checkout and
					// its administrative entry both retained.
					rememberCleanupFailure(
						`convex-consumer-compat: could not remove the baseline checkout ${dir}: ${
							error instanceof Error ? error.message : String(error)
						}`
					);
				}
				try {
					git(['worktree', 'prune'], process.cwd(), hooks);
				} catch (error) {
					// Everything else this function leaves behind lives in the system temporary
					// directory, but an unpruned entry is state inside the repository being
					// checked, and a later `git worktree` there reads it. Reported here so it
					// survives a primary failure, and raised below when there is none.
					rememberCleanupFailure(
						`convex-consumer-compat: could not prune the administrative worktree entry for ${dir}: ${
							error instanceof Error ? error.message : String(error)
						}`
					);
				}
			}
			// `git worktree prune` returning 0 only means it evaluated every entry. A locked
			// registration is intentionally retained and still returns 0, so the command status
			// cannot prove cleanup. Ask the registry itself before a successful verdict leaves.
			if (registeredDir) {
				try {
					if (worktreeRegistrationExists(registeredDir)) {
						rememberCleanupFailure(
							`convex-consumer-compat: left an administrative worktree entry for ${registeredDir}`
						);
					}
				} catch (error) {
					rememberCleanupFailure(
						`convex-consumer-compat: could not verify worktree cleanup for ${registeredDir}: ${
							error instanceof Error ? error.message : String(error)
						}`
					);
				}
			}
		}
		removeAfterExit(tempRoot);
	}
	if (cleanupFailure) throw new Error(cleanupFailure);
	return surface;
}

export async function main(): Promise<void> {
	const baseline = resolveBaseline();
	if (!baseline) {
		console.error(
			'convex-consumer-compat: no trunk to compare against (looked for origin/main and main). Fetch the trunk history before running this check; compatibility cannot be certified without a baseline.'
		);
		process.exit(1);
	}
	if ('unavailable' in baseline) {
		console.error(baseline.unavailable);
		process.exit(1);
	}
	if ('root' in baseline) {
		console.log('convex-consumer-compat: root commit, nothing promised yet.');
		process.exit(0);
	}

	const workingTreeUnresolved = consumerReferencesIn(
		BACKEND_ROOTS.flatMap((root) => workingTreeSources(root))
	).unresolved;
	const baselineConsumers = consumerReferencesIn(consumerSourcesAt(baseline.commit));
	if (workingTreeUnresolved.length > 0 || baselineConsumers.unresolved.length > 0) {
		console.error(
			'convex-consumer-compat: these scheduled calls have a target this check cannot resolve to a function path.\n'
		);
		for (const [where, targets] of [
			['working tree', workingTreeUnresolved],
			[`at ${baseline.commit.slice(0, 8)}`, baselineConsumers.unresolved]
		] as const) {
			for (const target of targets) {
				console.error(`  ${target.file}:${target.line} ${target.expression} (${where})`);
			}
		}
		console.error(
			'\nA pending job keeps the path its call scheduled, so an unknown target leaves\n' +
				'nothing for this check to keep published. Schedule an `internal.*` or `api.*`\n' +
				`path, a \`refs.internal.*\` or \`refs.public.*\` chain from ${CONFECT_REFS_MODULE},\n` +
				'or a const bound to one of them.'
		);
		process.exit(1);
	}
	const protectedIdentifiers = new Set([
		...baselineConsumers.references.map((ref) => ref.identifier),
		...baselineConsumers.namespaces.map((ref) => `${ref.prefix}:*`)
	]);
	const promised = surfaceAt(baseline.commit, protectedIdentifiers);
	const required = requiredReferences(baselineConsumers, promised);
	const available = await freshSurfaceOf(
		CONVEX_ROOT,
		new Set(required.map((ref) => ref.identifier))
	);
	const broken = brokenReferences(required, promised, available);

	if (broken.length === 0) {
		console.log(
			`convex-consumer-compat: ${new Set(required.map((r) => r.identifier)).size} referenced functions still published unchanged.`
		);
		process.exit(0);
	}

	const byIdentifier = new Map<string, Reference[]>();
	for (const ref of broken) {
		byIdentifier.set(ref.identifier, [...(byIdentifier.get(ref.identifier) ?? []), ref]);
	}

	console.error('convex-consumer-compat: deployed app code would lose these functions.\n');
	for (const [identifier, refs] of byIdentifier) {
		const was = promised.get(identifier)!;
		const now = available.get(identifier);
		const fate = !now
			? 'no longer exported'
			: now.kind !== was.kind
				? `now a ${now.kind}, was a ${was.kind}`
				: `now ${now.visibility}, was ${refs[0]!.visibility}`;
		console.error(`  ${identifier}: ${fate}`);
		console.error(
			`    referenced at ${baseline.commit.slice(0, 8)} from ${[...new Set(refs.map((r) => r.file))].join(', ')}`
		);
	}
	console.error(
		'\nConvex deploys before the app build, stale browser tabs outlive both, and a\n' +
			'platform rollback restores old app code against the new backend. Keep the old\n' +
			'name published exactly as it was. An alias to the new implementation is\n' +
			'enough. Remove it only after no supported client or pending scheduled job can\n' +
			'call it. See\n' +
			'https://github.com/stickerdaniel/saas-starter/issues/789.'
	);
	process.exit(1);
}

if (import.meta.main) await main();
