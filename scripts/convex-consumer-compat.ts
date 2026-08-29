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
 * adapters are read as text; persisted scheduler targets inside Convex use the
 * TypeScript syntax tree. A reference through a renamed import, bracket notation,
 * or a dynamically assembled value does not register. What it catches
 * reliably is the case that actually happens: a rename done in one commit across
 * both sides.
 */

import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import ts from 'typescript';

import {
	ENTRY_EXTENSIONS,
	freshSurfaceOf,
	type Registration,
	type Surface,
	type Visibility
} from './convex-surface';
import { isolatedGitEnv, sanitizedGitEnv } from './git-context';

const CONVEX_ROOT = 'src/lib/convex';
// App sources contribute direct and namespace-adapter references. Convex source
// contributes scheduler targets because persisted runAfter/runAt jobs outlive
// the deployment that created them.
const CONSUMER_ROOT = 'src';

export type Reference = { identifier: string; visibility: Visibility; file: string };
export type NamespaceReference = { prefix: string; visibility: Visibility; file: string };
type ConsumerReferences = { references: Reference[]; namespaces: NamespaceReference[] };

function git(
	args: string[],
	cwd = process.cwd(),
	hooksPath?: string,
	env = isolatedGitEnv()
): string {
	// stderr captured, not inherited: a probing rev-parse is allowed to fail
	// without printing git's `fatal:` above this script's own explanation. The exact
	// checkout remains usable when its owner differs from the process uid.
	const configuration = ['-c', `safe.directory=${realpathSync(cwd)}`];
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
 * The one call that has to reach the network, and so the one that cannot run under the
 * isolated environment. Emptying the global and system config also empties `url.*.insteadOf`,
 * the credential helpers and the proxy and CA settings, and a fetch that fails for want of
 * them falls back to the trunk: measured, a baseline reachable only through an insteadOf
 * rule went unfetched and the check certified the trunk instead. Every reader that decides
 * the verdict stays isolated; this one only has to bring objects in.
 */
function gitFetch(args: string[]): string {
	return git(args, process.cwd(), undefined, sanitizedGitEnv());
}

type Baseline = { commit: string } | { root: true } | { unavailable: string } | null;

function resolveBaseline(): Baseline {
	// Set by CI on trunk pushes to the push event's pre-push SHA: a push can
	// carry several commits, and HEAD~1 would let the first of them bless a
	// rename the deployed build never saw. Also the way to point the check at a
	// known-bad commit to prove it catches what it was written for. An all-zero
	// SHA (branch creation) falls back to the trunk resolution below; a nonzero
	// SHA that cannot be found fails CI instead of falling back, because the
	// one way that happens on a push is a force push that moved the deployed
	// tip out of reach: exactly the state in which HEAD~1 would bless what
	// that tip still calls.
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
		// Step back to the parent instead (CI pushes land here only when the
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
		ts.isSatisfiesExpression(current)
	) {
		current = current.expression;
	}
	return current;
}

function referenceFromExpression(expression: ts.Expression, file: string): Reference | null {
	let current = unwrapExpression(expression);
	const segments: string[] = [];
	while (ts.isPropertyAccessExpression(current)) {
		segments.unshift(current.name.text);
		current = current.expression;
	}
	if (!ts.isIdentifier(current) || (current.text !== 'api' && current.text !== 'internal')) {
		return null;
	}
	const identifier =
		segments.length < 2 ? null : `${segments.slice(0, -1).join('/')}:${segments.at(-1)}`;
	if (!identifier) return null;
	return { identifier, visibility: current.text === 'api' ? 'public' : 'internal', file };
}

function staticFunctionReferences(
	sourceFile: ts.SourceFile,
	file: string
): Map<string, Reference[]> {
	const references = new Map<string, Reference[]>();
	for (const statement of sourceFile.statements) {
		if (!ts.isVariableStatement(statement)) continue;
		for (const declaration of statement.declarationList.declarations) {
			if (!ts.isIdentifier(declaration.name) || !declaration.initializer) continue;
			const initializer = unwrapExpression(declaration.initializer);
			if (
				!ts.isCallExpression(initializer) ||
				!ts.isIdentifier(initializer.expression) ||
				initializer.expression.text !== 'makeFunctionReference'
			)
				continue;
			const identifier = initializer.arguments[0];
			if (!identifier || !ts.isStringLiteralLike(identifier)) continue;
			if (!/^(?:[A-Za-z0-9_]+\/)*[A-Za-z0-9_]+:[A-Za-z0-9_]+$/.test(identifier.text)) continue;
			// makeFunctionReference does not encode visibility at runtime. Preserve both
			// candidates here; the baseline surface keeps only the one actually published.
			references.set(declaration.name.text, [
				{ identifier: identifier.text, visibility: 'public', file },
				{ identifier: identifier.text, visibility: 'internal', file }
			]);
		}
	}
	return references;
}

function bindingNameContains(binding: ts.BindingName, name: string): boolean {
	if (ts.isIdentifier(binding)) return binding.text === name;
	return binding.elements.some(
		(element) => !ts.isOmittedExpression(element) && bindingNameContains(element.name, name)
	);
}

function statementsDeclareBlockBinding(statements: readonly ts.Statement[], name: string): boolean {
	return statements.some((statement) => {
		if (ts.isVariableStatement(statement)) {
			return (
				(statement.declarationList.flags & ts.NodeFlags.BlockScoped) !== 0 &&
				statement.declarationList.declarations.some((declaration) =>
					bindingNameContains(declaration.name, name)
				)
			);
		}
		return (
			((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) &&
				statement.name?.text === name) ??
			false
		);
	});
}

function functionDeclaresVarBinding(body: ts.ConciseBody | undefined, name: string): boolean {
	if (!body) return false;
	let found = false;
	const visit = (node: ts.Node): void => {
		if (found || (node !== body && ts.isFunctionLike(node))) return;
		if (
			ts.isVariableDeclarationList(node) &&
			(node.flags & ts.NodeFlags.BlockScoped) === 0 &&
			node.declarations.some((declaration) => bindingNameContains(declaration.name, name))
		) {
			found = true;
			return;
		}
		ts.forEachChild(node, visit);
	};
	visit(body);
	return found;
}

function shadowsStaticReference(target: ts.Identifier): boolean {
	let ancestor: ts.Node | undefined = target.parent;
	while (ancestor && !ts.isSourceFile(ancestor)) {
		if (ts.isBlock(ancestor) && statementsDeclareBlockBinding(ancestor.statements, target.text)) {
			return true;
		}
		if (
			ts.isCaseBlock(ancestor) &&
			statementsDeclareBlockBinding(
				ancestor.clauses.flatMap((clause) => clause.statements),
				target.text
			)
		) {
			return true;
		}
		if (ts.isCatchClause(ancestor) && ancestor.variableDeclaration) {
			if (bindingNameContains(ancestor.variableDeclaration.name, target.text)) return true;
		}
		if (
			(ts.isForStatement(ancestor) ||
				ts.isForInStatement(ancestor) ||
				ts.isForOfStatement(ancestor)) &&
			ancestor.initializer &&
			ts.isVariableDeclarationList(ancestor.initializer) &&
			(ancestor.initializer.flags & ts.NodeFlags.BlockScoped) !== 0 &&
			ancestor.initializer.declarations.some((declaration) =>
				bindingNameContains(declaration.name, target.text)
			)
		) {
			return true;
		}
		if (ts.isFunctionLike(ancestor)) {
			if (
				ancestor.parameters.some((parameter) => bindingNameContains(parameter.name, target.text))
			) {
				return true;
			}
			if (ancestor.name && ts.isIdentifier(ancestor.name) && ancestor.name.text === target.text) {
				return true;
			}
			if (functionDeclaresVarBinding(ancestor.body, target.text)) return true;
		}
		if (
			(ts.isClassDeclaration(ancestor) || ts.isClassExpression(ancestor)) &&
			ancestor.name?.text === target.text
		) {
			return true;
		}
		ancestor = ancestor.parent;
	}
	return false;
}

export function scheduledIdentifiersIn(source: string, file: string): Reference[] {
	const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
	const staticReferences = staticFunctionReferences(sourceFile, file);
	const found: Reference[] = [];
	const visit = (node: ts.Node): void => {
		if (
			ts.isCallExpression(node) &&
			ts.isPropertyAccessExpression(node.expression) &&
			(node.expression.name.text === 'runAfter' || node.expression.name.text === 'runAt') &&
			node.arguments[1]
		) {
			const receiver = unwrapExpression(node.expression.expression);
			if (ts.isPropertyAccessExpression(receiver) && receiver.name.text === 'scheduler') {
				const target = unwrapExpression(node.arguments[1]);
				const reference = referenceFromExpression(target, file);
				if (reference) found.push(reference);
				else if (ts.isIdentifier(target) && !shadowsStaticReference(target)) {
					found.push(...(staticReferences.get(target.text) ?? []));
				}
			}
		}
		ts.forEachChild(node, visit);
	};
	visit(sourceFile);
	return found;
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

function consumerReferencesAt(commit: string): ConsumerReferences {
	const files = git(['ls-tree', '-r', '--name-only', commit, '--', CONSUMER_ROOT])
		.split('\n')
		.filter(isConsumerSource);
	const references: Reference[] = [];
	const namespaces: NamespaceReference[] = [];
	for (const file of files) {
		const source = git(['show', `${commit}:${file}`]);
		if (file.startsWith(`${CONVEX_ROOT}/`)) {
			references.push(...scheduledIdentifiersIn(source, file));
			continue;
		}
		references.push(...identifiersIn(source, file));
		namespaces.push(...namespaceReferencesIn(source, file));
	}
	return { references, namespaces };
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
	let cleanupFailure: string | undefined;
	let surface: Surface;
	try {
		mkdirSync(hooks);
		// A linked worktree of this repository, not a clone of it. A clone has to reach the
		// baseline commit through a transport, and measured with git 2.55.0 that loses two
		// things this check depends on: a shared clone of a shallow repository writes no
		// `objects/info/alternates`, so a commit only `FETCH_HEAD` reaches disappears, and a
		// shared clone of a partial one borrows the incomplete object store without inheriting
		// `remote.origin.promisor`, so a missing blob can never be fetched. Both fail a
		// baseline the surrounding repository resolved perfectly well. The empty hook
		// directory and the isolated attribute sources are what keep the checkout itself
		// independent of machine-local Git behavior.
		git(['worktree', 'add', '--detach', '--quiet', dir, commit], process.cwd(), hooks);
		worktreeAdded = true;
		const childEnv = { ...isolatedGitEnv(), HUSKY: '0' };
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
			try {
				git(['worktree', 'remove', '--force', dir], process.cwd(), hooks);
			} catch {
				rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
				try {
					git(['worktree', 'prune'], process.cwd(), hooks);
				} catch (error) {
					// Everything else this function leaves behind lives in the system temporary
					// directory, but an unpruned entry is state inside the repository being
					// checked, and a later `git worktree` there reads it. Reported here so it
					// survives a primary failure, and raised below when there is none.
					cleanupFailure = `convex-consumer-compat: left an administrative worktree entry for ${dir}: ${
						error instanceof Error ? error.message : String(error)
					}`;
					console.error(cleanupFailure);
				}
			}
		}
		// The temporary root is outside the repository, so failing to remove it changes
		// nothing a later command can read. Throwing here would discard an answer the checker
		// already computed and replace the install or checkout diagnostic that preceded it.
		try {
			rmSync(tempRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
		} catch (error) {
			console.error(
				`convex-consumer-compat: could not remove the baseline directory ${tempRoot}: ${
					error instanceof Error ? error.message : String(error)
				}`
			);
		}
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

	const baselineConsumers = consumerReferencesAt(baseline.commit);
	const protectedIdentifiers = new Set([
		...baselineConsumers.references.map((ref) => ref.identifier),
		...baselineConsumers.namespaces.map((ref) => `${ref.prefix}:*`)
	]);
	const promised = surfaceAt(baseline.commit, protectedIdentifiers);
	const baselineReferences = [
		...baselineConsumers.references,
		...expandNamespaceReferences(baselineConsumers.namespaces, promised)
	];
	// A reference only counts if the baseline actually delivered it the way the
	// consumer asked (public through `api.`, internal through `internal.`): one
	// that did not match was broken or noise already.
	const required = baselineReferences.filter(
		(ref) => promised.get(ref.identifier)?.visibility === ref.visibility
	);
	const available = await freshSurfaceOf(
		CONVEX_ROOT,
		new Set(required.map((ref) => ref.identifier))
	);
	const broken = required.filter((ref) => {
		const was = promised.get(ref.identifier)!;
		const now = available.get(ref.identifier);
		return !now || now.kind !== was.kind || now.visibility !== ref.visibility;
	});

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
