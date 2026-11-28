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
 * and follow local bindings. In the Confect directory, a `runAfter` or `runAt`
 * target that does not resolve to a function path fails the check. In the
 * functions directory, so does a target rooted in an `api` or `internal` import
 * from a module other than the generated api.
 */

import { execFileSync, spawn } from 'node:child_process';
import {
	copyFileSync,
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

import {
	backendPaths,
	brokenReferences,
	consumerReferencesIn,
	isConsumerSource,
	isSchedulerModule,
	requiredReferences,
	schedulerRoots,
	workingTreeSources,
	type BackendPaths,
	type ConsumerReferences,
	type ConsumerSource,
	type Reference
} from './convex-references';
import { freshSurfaceOf, SURFACE_READER, type Registration, type Surface } from './convex-surface';
import { isolatedGitEnv, sanitizedGitEnv } from './git-context';

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

interface RevisionTree {
	readonly name: string;
	readonly isFile: (file: string) => boolean;
	readonly isDirectory: (directory: string) => boolean;
	readonly directoriesIn: (directory: string) => string[];
	readonly read: (file: string) => string;
	readonly sources: (roots: readonly string[]) => ConsumerSource[];
}

type TreeEntry = { type: string; object: string; file: string };

function isBelowAny(file: string, roots: readonly string[]): boolean {
	return roots.some((root) => file.startsWith(`${root}/`));
}

/**
 * Every consumer source below the roots at `commit`, read through one `cat-file --batch`.
 * A `git show` per file cost one process per source: measured 2026-11-03, 982 of them took
 * 22 s on a 24-core host at load 70, a fifth of the time a test had to run this check.
 */
function readBlobs(commit: string, entries: readonly TreeEntry[], cwd: string): ConsumerSource[] {
	if (entries.length === 0) return [];
	const output = execFileSync(
		'git',
		['-c', `safe.directory=${realpathSync(cwd)}`, 'cat-file', '--batch'],
		{
			cwd,
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

export function commitTree(commit: string, cwd = process.cwd()): RevisionTree {
	const entries = new Map<string, TreeEntry>();
	const children = new Map<string, Set<string>>([['', new Set()]]);
	for (const record of git(['ls-tree', '-r', '-z', commit], cwd).split('\0').filter(Boolean)) {
		// `<mode> <type> <object>\t<path>`; the path is the only field that may hold spaces.
		const tab = record.indexOf('\t');
		const [, type, object] = record.slice(0, tab).split(' ');
		const file = record.slice(tab + 1);
		entries.set(file, { type: type!, object: object!, file });
		const parts = file.split('/');
		for (let depth = 1; depth < parts.length; depth++) {
			const directory = parts.slice(0, depth).join('/');
			const parent = parts.slice(0, depth - 1).join('/');
			children.set(parent, (children.get(parent) ?? new Set()).add(parts[depth - 1]!));
			if (!children.has(directory)) children.set(directory, new Set());
		}
	}
	const blob = (file: string): TreeEntry | undefined => {
		const entry = entries.get(file);
		return entry?.type === 'blob' ? entry : undefined;
	};
	return {
		name: commit.slice(0, 8),
		isFile: (file) => blob(file) !== undefined,
		isDirectory: (directory) => children.has(directory),
		directoriesIn: (directory) => [...(children.get(directory) ?? [])].sort(),
		read: (file) => {
			const entry = blob(file);
			if (!entry) throw new Error(`convex-consumer-compat: ${commit.slice(0, 8)} holds no ${file}`);
			return git(['cat-file', 'blob', entry.object], cwd);
		},
		sources: (roots) =>
			readBlobs(
				commit,
				[...entries.values()].filter(
					({ file }) => isBelowAny(file, roots) && isConsumerSource(file)
				),
				cwd
			)
	};
}

function workingTree(): RevisionTree {
	const isDirectory = (directory: string): boolean =>
		statSync(directory || '.', { throwIfNoEntry: false })?.isDirectory() === true;
	return {
		name: 'the working tree',
		isFile: (file) => statSync(file, { throwIfNoEntry: false })?.isFile() === true,
		isDirectory,
		directoriesIn: (directory) =>
			isDirectory(directory)
				? readdirSync(directory || '.', { withFileTypes: true })
						.filter((entry) => entry.isDirectory())
						.map((entry) => entry.name)
						.sort()
				: [],
		read: (file) => readFileSync(file, 'utf8'),
		sources: (roots) => roots.flatMap((root) => workingTreeSources(root))
	};
}

export type Layout =
	| { readonly kind: 'flat'; readonly backendRoot: ''; readonly backend: BackendPaths }
	| {
			readonly kind: 'workspace';
			readonly backendRoot: string;
			readonly backend: BackendPaths;
			readonly members: readonly string[];
	  };

type LayoutReading = { readonly layout: Layout } | { readonly refusal: string };

function setupVersionsOf(kind: Layout['kind']): readonly number[] {
	switch (kind) {
		case 'flat':
			return [1, 2];
		case 'workspace':
			return [3];
	}
}

function consumerRootsOf(layout: Layout, tree: RevisionTree): string[] {
	switch (layout.kind) {
		case 'flat':
			return ['src'];
		case 'workspace':
			return [
				...layout.members.map((member) => `${member}/src`),
				...tree
					.directoriesIn(layout.backendRoot)
					.filter((name) => name !== 'scripts' && name !== 'node_modules' && !name.startsWith('.'))
					.map((name) => `${layout.backendRoot}/${name}`)
			];
	}
}

function sourceRootsOf(layout: Layout, tree: RevisionTree): string[] {
	const roots = [...new Set([...consumerRootsOf(layout, tree), ...schedulerRoots(layout.backend)])];
	return roots.filter((root) => !isBelowAny(root, roots)).sort();
}

export function consumerSourcesAt(tree: RevisionTree, layout: Layout): ConsumerSource[] {
	return tree.sources(sourceRootsOf(layout, tree));
}

function jsonObjectAt(tree: RevisionTree, file: string): Record<string, unknown> | string {
	let parsed: unknown;
	try {
		parsed = JSON.parse(tree.read(file));
	} catch {
		parsed = undefined;
	}
	if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
		return parsed as Record<string, unknown>;
	}
	return `convex-consumer-compat: ${file} at ${tree.name} is no JSON object.`;
}

const UNSUPPORTED_PATTERN = /[!?[\]{}]|\*\*/;

function membersOf(tree: RevisionTree, workspaces: unknown): string[] | string {
	const patterns =
		workspaces === undefined
			? []
			: Array.isArray(workspaces)
				? workspaces
				: typeof workspaces === 'object' && workspaces !== null && 'packages' in workspaces
					? workspaces.packages
					: undefined;
	if (
		!Array.isArray(patterns) ||
		!patterns.every((pattern): pattern is string => typeof pattern === 'string')
	) {
		return `convex-consumer-compat: the workspaces of package.json at ${tree.name} are no list of paths.`;
	}
	const members = new Set<string>();
	for (const pattern of patterns) {
		const normalized = path.posix.normalize(pattern).replace(/^\.\//, '').replace(/\/$/, '');
		if (
			UNSUPPORTED_PATTERN.test(normalized) ||
			normalized.startsWith('..') ||
			normalized.startsWith('/')
		) {
			return `convex-consumer-compat: package.json at ${tree.name} names the workspace pattern ${JSON.stringify(pattern)}, which this check cannot expand.`;
		}
		let directories = [''];
		for (const segment of normalized.split('/')) {
			const matcher = new RegExp(
				`^${segment.replace(/[.+^$()|\\]/g, '\\$&').replaceAll('*', '[^/]*')}$`
			);
			directories = directories.flatMap((directory) =>
				segment.includes('*')
					? tree
							.directoriesIn(directory)
							.filter((name) => name !== 'node_modules' && matcher.test(name))
							.map((name) => path.posix.join(directory, name))
					: tree.isDirectory(path.posix.join(directory, segment))
						? [path.posix.join(directory, segment)]
						: []
			);
		}
		for (const directory of directories) {
			if (tree.isFile(`${directory}/package.json`)) members.add(directory);
		}
	}
	return [...members].sort();
}

function layoutOf(tree: RevisionTree): LayoutReading {
	const manifest = tree.isFile('package.json') ? jsonObjectAt(tree, 'package.json') : {};
	if (typeof manifest === 'string') return { refusal: manifest };
	const members = membersOf(tree, manifest.workspaces);
	if (typeof members === 'string') return { refusal: members };
	const candidates = ['', ...members].filter((directory) =>
		tree.isFile(path.posix.join(directory, 'convex.json'))
	);
	if (candidates.length !== 1) {
		const named = candidates.map((directory) => path.posix.join(directory, 'convex.json'));
		return {
			refusal:
				candidates.length === 0
					? `convex-consumer-compat: ${tree.name} holds no convex.json at its root or at the root of a member that package.json names in workspaces (${members.join(', ') || 'none'}), so this check cannot tell where its backend is.`
					: `convex-consumer-compat: ${tree.name} holds ${named.join(' and ')}, so this check cannot tell which one is its backend.`
		};
	}
	const backendRoot = candidates[0]!;
	const configFile = path.posix.join(backendRoot, 'convex.json');
	const config = jsonObjectAt(tree, configFile);
	if (typeof config === 'string') return { refusal: config };
	if (config.functions !== undefined && typeof config.functions !== 'string') {
		return {
			refusal: `convex-consumer-compat: the functions entry of ${configFile} at ${tree.name} is no path.`
		};
	}
	const convexRoot = path.posix
		.normalize(path.posix.join(backendRoot, config.functions ?? 'convex'))
		.replace(/\/$/, '');
	if (convexRoot.startsWith('..') || !tree.isDirectory(convexRoot)) {
		return {
			refusal: `convex-consumer-compat: ${configFile} at ${tree.name} names the functions directory ${convexRoot}, which ${tree.name} does not hold.`
		};
	}
	const backend = backendPaths(convexRoot);
	const layout: Layout =
		backendRoot === ''
			? { kind: 'flat', backendRoot, backend }
			: { kind: 'workspace', backendRoot, backend, members };
	const version = manifest.templateSetupVersion;
	if (
		version !== undefined &&
		!(typeof version === 'number' && setupVersionsOf(layout.kind).includes(version))
	) {
		return {
			refusal: `convex-consumer-compat: package.json at ${tree.name} declares templateSetupVersion ${JSON.stringify(version)}, and ${configFile} gives it the ${layout.kind} layout, which takes ${setupVersionsOf(layout.kind).join(' or ')}.`
		};
	}
	return { layout };
}

type Discovery = {
	readonly layout: Layout;
	readonly references: ConsumerReferences;
};

function discover(tree: RevisionTree): Discovery {
	const reading = layoutOf(tree);
	if ('refusal' in reading) {
		console.error(reading.refusal);
		process.exit(1);
	}
	const { layout } = reading;
	const sources = consumerSourcesAt(tree, layout);
	const schedulerModules = sources.filter(({ file }) =>
		isSchedulerModule(file, layout.backend)
	).length;
	console.log(
		`convex-consumer-compat: ${tree.name} has the ${layout.kind} layout with its functions in ${layout.backend.convexRoot}: ${sources.length - schedulerModules} consumers, ${schedulerModules} scheduler modules.`
	);
	return { layout, references: consumerReferencesIn(sources, layout.backend) };
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
 * deletion, and runs in the temporary directory, so Bun loads no project `bunfig.toml` for it.
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
 * reader is copied into the backend root of that checkout and executed there, so it also
 * loads the baseline's TypeScript package.
 */
function surfaceAt(
	commit: string,
	layout: Layout,
	protectedIdentifiers: ReadonlySet<string>
): Surface {
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

		const backendDirectory = path.join(dir, layout.backendRoot);
		const reader = path.join(backendDirectory, '.convex-surface-reader.ts');
		copyFileSync(SURFACE_READER, reader);
		const serialized = execFileSync(
			process.execPath,
			[reader, path.join(dir, layout.backend.convexRoot)],
			{
				cwd: backendDirectory,
				encoding: 'utf8',
				maxBuffer: 32 * 1024 * 1024,
				stdio: ['ignore', 'pipe', 'pipe'],
				env: {
					...childEnv,
					CONVEX_SURFACE_PROTECTED_IDENTIFIERS: JSON.stringify([...protectedIdentifiers])
				}
			}
		);
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

	const head = discover(workingTree());
	const workingTreeUnresolved = head.references.unresolved;
	const base = discover(commitTree(baseline.commit));
	const baselineConsumers = base.references;
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
				`path, a \`refs.internal.*\` or \`refs.public.*\` chain from ${head.layout.backend.confectRefsModule},\n` +
				'or a const bound to one of them.'
		);
		process.exit(1);
	}
	const protectedIdentifiers = new Set([
		...baselineConsumers.references.map((ref) => ref.identifier),
		...baselineConsumers.namespaces.map((ref) => `${ref.prefix}:*`)
	]);
	const promised = surfaceAt(baseline.commit, base.layout, protectedIdentifiers);
	const required = requiredReferences(baselineConsumers, promised);
	const available = await freshSurfaceOf(
		head.layout.backend.convexRoot,
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
