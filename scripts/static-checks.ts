/**
 * Unified static checks script (cross-platform TypeScript version)
 *
 * Usage:
 *   bun scripts/static-checks.ts                      - Check all files, auto-fix (local dev)
 *   bun scripts/static-checks.ts --ci                  - Check all files, assert-only (CI)
 *   bun scripts/static-checks.ts --ci --scope lint     - Linting checks only (CI job group)
 *   bun scripts/static-checks.ts --ci --scope types    - Type checking only (CI job group)
 *   bun scripts/static-checks.ts --scope compat        - Convex consumer compatibility only
 *   bun scripts/static-checks.ts --scope format files  - Assert formatting only
 *   bun scripts/static-checks.ts --staged              - Check only staged files (pre-commit)
 *   bun scripts/static-checks.ts file1.ts file2.svelte - Check specific files
 *   ... | bun scripts/static-checks.ts --files-from -  - Check a NUL-separated computed list
 *                                                        (see --files-from on the producer's
 *                                                        exit status, which a pipe discards)
 *
 * Flags:
 *   --ci         Assert mode: uses --check for formatting, omits --fix for ESLint.
 *                Requires misspell to be installed (fails if missing).
 *   --staged     Assert-only staged-file gate; skips knip. Run fix mode before staging and retrying.
 *   --scope      Run a subset of checks: "lint" (misspell, literal controls, banned patterns, prettier,
 *                eslint, oxlint, knip), "types" (build-emails, svelte-check), assert-only "format"
 *                (prettier), or full-project-only "compat" (Convex consumer compatibility).
 *                Lint and types run svelte-kit sync first.
 *                Omit to run lint and types.
 *   --files-from Read NUL-separated UTF-8 paths from a file, or from stdin with "-".
 *                This matches `git diff --no-relative --name-only --diff-filter=d -z`
 *                without quoting, deleted paths, or delimiter ambiguity. Records are
 *                repository-relative, and --no-relative is what keeps them so: with
 *                diff.relative set, git strips the prefix of the current subdirectory
 *                and drops everything above it, so a record would name a same-named
 *                file at the root. An empty stream is an honest no-op, and that is
 *                what makes the producer's exit status the caller's job: a shell
 *                without `pipefail` reports only the last command, so `git diff`
 *                exiting 128 on a bad revision emits nothing, this checker exits 0
 *                over an empty list, and the pipeline reads as a pass. Write the list
 *                to a file and check git's status before invoking, or set `pipefail`.
 *                Measured: pipeline_status=0 git_status=128 checker_status=0.
 *
 * Paths are validated and normalized at intake (see resolveInputs). An empty
 * argument, a newline-joined blob, a missing path, or a path outside the repo is a
 * hard error, never a run that checks nothing and reports success.
 */

import {
	existsSync,
	lstatSync,
	readFileSync,
	readdirSync,
	readlinkSync,
	realpathSync,
	statSync
} from 'fs';
import { availableParallelism } from 'os';
import path from 'path';
import { getFileInfo } from 'prettier';
import { fileURLToPath } from 'url';
import { parseArgs } from 'util';
import knowledgePolicy from '../knowledge-policy.config';
import { findLiteralControlCharacters } from '../eslint/control-character-policy.js';
import {
	activeGitIndexFingerprint,
	getGitInventory,
	getStagedChanges,
	getStagedFiles,
	gitlinkHeadObjectId,
	hashWorktreeFileNoFilters,
	type GitInventoryEntry,
	isGitIgnoredPath,
	sanitizedGitEnv,
	stagedFilesMatchWorktree,
	stagedFilesWithCleanFilters,
	stagedGitEnv
} from './git-context';
import { formatPolicyFinding, matchesKnowledgeCandidate } from './knowledge-policy/policy';
import { runKnowledgePolicy } from './knowledge-policy/repository';
import {
	runSanitizedCommand,
	sanitizeTerminalField,
	sanitizeTerminalText,
	type SanitizedCommandOptions
} from './terminal-output';

// Configuration (matches CI static-checks.yml exclusions)
const CONFIG = {
	ignorePaths: ['references/', 'scratch/'],
	misspell: {
		ignore: [
			'src/i18n/',
			'convex/_generated/',
			'node_modules/',
			'.git/',
			'.svelte-kit/',
			'references/'
		]
	},
	bannedPatterns: {
		/** Removed shadcn v1 / Tailwind v3 tokens and legacy class names */
		deprecated:
			/ring-offset-background|ring-offset-foreground|text-destructive-foreground|flex-shrink-0|bg-gradient-to-/,
		/** animate-spin without motion-safe: prefix (WCAG 2.3.3) */
		bareAnimateSpin: /(?<!motion-safe:)animate-spin/,
		/**
		 * Static value imports/re-exports of the Sentry SDK under src/. They defeat
		 * dead-code elimination when PUBLIC_SENTRY_DSN is unset and ship the SDK to
		 * first paint. Lazy-load via $lib/monitoring/sentry instead; `import type`
		 * stays allowed (erased at build time).
		 */
		staticSentryImport: /(?:import|export)\s+(?!type[\s{])[^'"]*from\s*['"]@sentry\/sveltekit['"]/,
		/**
		 * Shell-string spawning. Removed in #473/#514; build argument arrays and use
		 * spawn-style helpers instead (see runCommandCapture in scripts/deploy/utils.ts).
		 * Scope: this scanner only covers .svelte/.ts files under src/ (full runs glob
		 * that set; --staged/file-args runs filter the given files down to it).
		 */
		execSync: /\bexecSync\s*\(/,
		/**
		 * Ungated Tolgee apiKey in the root layout. Passing the key straight to
		 * tolgeeBuilder.init leaves it in place through DCE, so Vite inlines it into
		 * the deployed client bundle and production/preview builds fetch translations
		 * from the Tolgee server at runtime. Gate it behind import.meta.env.DEV (see
		 * src/routes/+layout.svelte) so the key and its value are dead-code-eliminated
		 * from non-dev builds. The gated form reads `import.meta.env.DEV ?` right after
		 * the colon, so this pattern only matches the unguarded assignment.
		 */
		ungatedTolgeeApiKey: /apiKey:\s*import\.meta\.env\.VITE_TOLGEE_API_KEY/
	}
};

// ANSI colors for direct terminal runs; wrappers set NO_COLOR before sanitizing output.
const colors =
	process.env.NO_COLOR === undefined
		? {
				reset: '\x1b[0m',
				bold: '\x1b[1m',
				green: '\x1b[32m',
				yellow: '\x1b[33m',
				red: '\x1b[31m'
			}
		: { reset: '', bold: '', green: '', yellow: '', red: '' };

// ===========================================================================
// Intake — argv and file arguments become validated, repo-relative POSIX paths
// ===========================================================================

/** Repo root, from this script's own location. Correct under worktrees and nesting. */
// fileURLToPath, not Bun's import.meta.dir: the latter is undefined under vitest,
// which imports this module for scripts/static-checks.test.ts.
const REPO_ROOT = realpathSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'));

const USAGE = '  Flags: --ci, --staged, --scope <lint|types|format|compat>, --files-from <path|->';

/** Directories never descended into when a directory argument is expanded. */
/**
 * Directories a directory expansion never descends into, split the way .gitignore splits
 * them: `/build`, `/dist` and `/.svelte-kit` are anchored there and a tracked
 * `src/build/generator.ts` is an ordinary source file, while `node_modules`, `.git` and
 * `.convex` are ignored at any depth. Comparing segments against one flat list dropped the
 * former from a run that stayed green on its other inputs; comparing substrings, as this
 * did before, also read `src/redist/` as `dist/`.
 */
const NEVER_WALK_ANYWHERE = new Set(['node_modules', '.git', '.convex']);
const NEVER_WALK_AT_ROOT = new Set(['.svelte-kit', 'build', 'dist']);

export function isNeverWalked(file: string): boolean {
	const segments = file.split('/');
	return (
		segments.some((segment) => NEVER_WALK_ANYWHERE.has(segment)) ||
		NEVER_WALK_AT_ROOT.has(segments[0]!)
	);
}

/**
 * Reject the run. A gate that cannot see its input must never report success.
 */
function fail(message: string, hint?: string): never {
	console.error(`${colors.red}${sanitizeTerminalField(message)}${colors.reset}`);
	if (hint) console.error(sanitizeTerminalText(hint));
	process.exit(1);
}

const PATH_BIDI = new Set([
	0x061c, 0x200e, 0x200f, 0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069
]);

function unsafePathCodepoint(code: number): boolean {
	return (
		code <= 0x1f ||
		code === 0x7f ||
		(code >= 0x80 && code <= 0x9f) ||
		code === 0x2028 ||
		code === 0x2029 ||
		code === 0xfeff ||
		code === 0xfffd ||
		PATH_BIDI.has(code)
	);
}

export function formatPathForDiagnostic(file: string): string {
	let escaped = '';
	for (let index = 0; index < file.length; index++) {
		const code = file.charCodeAt(index);
		escaped += unsafePathCodepoint(code)
			? `\\u${code.toString(16).padStart(4, '0').toUpperCase()}`
			: file[index];
	}
	return JSON.stringify(escaped);
}

export function unsafePathCodepoints(file: string): string[] {
	const found: string[] = [];
	for (let index = 0; index < file.length; index++) {
		const code = file.charCodeAt(index);
		if (unsafePathCodepoint(code)) {
			found.push(`U+${code.toString(16).padStart(4, '0').toUpperCase()}`);
		}
	}
	return found;
}

export function assertSafePaths(files: string[]): void {
	for (const file of files) {
		const [codepoint] = unsafePathCodepoints(file);
		if (codepoint) {
			fail(`Unsafe ${codepoint} in repository path ${formatPathForDiagnostic(file)}.`);
		}
	}
}

function decodeUtf8(bytes: Uint8Array, error: string): string {
	try {
		return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
	} catch {
		fail(error);
	}
}

export function repositoryPaths(): string[] {
	return getGitInventory(REPO_ROOT).map((entry) => entry.path);
}

export function existingRepositoryPaths(files: string[]): string[] {
	return files.filter((file) => existsSync(path.join(REPO_ROOT, file)));
}

/** Paths Prettier's `.` traversal can visit; it does not follow symbolic links. */
/**
 * The formatter's own view of a path list: symlinks removed, missing paths either fatal or
 * dropped. Prettier exits 2 on an explicitly named symlink ("Explicitly specified pattern
 * ... is a symbolic link"), and this deliberately differs: a link carries a target path
 * rather than formattable source, so refusing one would fail a whole computed list over an
 * entry that has nothing to format. A list that holds only links is therefore an honest
 * zero, the same as a list of images.
 */
export function prettierProjectPaths(
	files: string[],
	cwd = REPO_ROOT,
	failOnMissing = false
): string[] {
	return files.filter((file) => {
		try {
			const entry = lstatSync(path.join(cwd, file));
			if (entry.isSymbolicLink()) return false;
			if (!entry.isFile()) {
				fail(`Named formatter path is not a regular file: ${formatPathForDiagnostic(file)}.`);
			}
			return true;
		} catch (error) {
			if (!isMissingPathError(error)) throw error;
			if (failOnMissing) {
				fail(`Named path disappeared before formatter routing: ${formatPathForDiagnostic(file)}.`);
			}
			return false;
		}
	});
}

/** A path that vanished between two syscalls, which is the only traversal race to absorb. */
function isMissingPathError(error: unknown): boolean {
	return (error as NodeJS.ErrnoException | null)?.code === 'ENOENT';
}

/**
 * Directory segments Prettier's CLI skips before glob expansion, whether or not an ignore
 * file names them. `getFileInfo()` applies node_modules and ignore files but not this VCS
 * list, so explicit paths need the same closed set here or the ledger counts work the CLI
 * silently discards. Pinned against Prettier 3.9.5's DirectoryIgnorer in the contract tests.
 */
const PRETTIER_ALWAYS_IGNORED_DIRECTORIES = new Set(['.git', '.sl', '.svn', '.hg', '.jj']);

function isPrettierAlwaysIgnoredPath(file: string): boolean {
	return file.split('/').some((segment) => PRETTIER_ALWAYS_IGNORED_DIRECTORIES.has(segment));
}

/** Files reachable by Prettier's directory traversal before file-level classification. */
export function prettierTraversalPaths(
	cwd = REPO_ROOT,
	skipSessionArtifacts = false,
	relativeTo = cwd
): string[] {
	const files: string[] = [];
	const skippedDirectories = new Set([...PRETTIER_ALWAYS_IGNORED_DIRECTORIES, 'node_modules']);
	const walk = (directory: string, prefix: string): void => {
		// The same race in the other direction: the directory itself can be gone by the time
		// the recursion reaches it, and only that case is a skip.
		let names;
		try {
			names = readdirSync(directory, { encoding: 'buffer' });
		} catch (error) {
			if (isMissingPathError(error)) return;
			throw error;
		}
		for (const rawName of names) {
			const name = decodeUtf8(
				rawName,
				'Repository contains a path whose bytes are not valid UTF-8.'
			);
			const absolute = path.join(directory, name);
			// Prettier reads this phase through its own `lstatSafe`, which swallows ENOENT and
			// nothing else, and a generated tree such as .svelte-kit can lose an entry to a
			// concurrent sync between the readdir above and the stat below. Skipping a vanished
			// entry matches what the formatter would have decided; swallowing EACCES or EIO
			// would instead hide a directory this ledger is supposed to account for.
			let entry;
			try {
				entry = lstatSync(absolute);
			} catch (error) {
				if (isMissingPathError(error)) continue;
				throw error;
			}
			if (entry.isSymbolicLink()) continue;
			const relative = prefix ? `${prefix}/${name}` : name;
			if (entry.isDirectory()) {
				if (skippedDirectories.has(name) || (skipSessionArtifacts && relative === 'scratch')) {
					continue;
				}
				walk(absolute, relative);
				continue;
			}
			if (entry.isFile()) files.push(relative);
		}
	};
	walk(cwd, toPosix(path.relative(relativeTo, cwd)));
	return files.sort();
}

function toPosix(p: string): string {
	return p.split(path.sep).join('/');
}

export interface ResolvedInput {
	/** Der logische Repository-Name steuert Regeln, Ignore-Muster und Diagnosen. */
	path: string;
	/** Das validierte physische Ziel steuert Inhaltszugriff und Compiler-Zuständigkeit. */
	target: string;
	kind: 'file' | 'symlink' | 'git-symlink-placeholder' | 'git-metadata-placeholder' | 'gitlink';
	linkChain: Array<{ path: string; target: string }>;
	inventoryPaths: string[];
	formatterLinkNoop: boolean;
	gitObjectId?: string;
	placeholderTarget?: string;
	gitEnv?: NodeJS.ProcessEnv;
}

type InventoryProvider = (directory: string) => GitInventoryEntry[];
type ResolverOptions = {
	gitEnv?: NodeJS.ProcessEnv;
	allowMetadataPlaceholders?: boolean;
};

function isOutsideRepository(absolute: string): boolean {
	const native = path.relative(REPO_ROOT, absolute);
	const relative = toPosix(native);
	return relative === '..' || relative.startsWith('../') || path.isAbsolute(native);
}

function resolveFilesystemPath(
	absolute: string,
	seenLinks = new Set<string>(),
	depth = 0,
	linkChain?: Array<{ path: string; target: string }>
): string {
	if (process.platform === 'win32') return realpathSync(absolute);
	if (depth > 40) {
		const error = new Error('Too many symbolic links.') as NodeJS.ErrnoException;
		error.code = 'ELOOP';
		throw error;
	}
	const parsed = path.parse(path.resolve(absolute));
	const segments = path.resolve(absolute).slice(parsed.root.length).split(path.sep).filter(Boolean);
	let current = parsed.root;
	for (let index = 0; index < segments.length; index++) {
		current = path.join(current, segments[index]!);
		const entry = lstatSync(current);
		if (!entry.isSymbolicLink()) continue;
		if (seenLinks.has(current)) {
			const error = new Error('Symbolic-link cycle.') as NodeJS.ErrnoException;
			error.code = 'ELOOP';
			throw error;
		}
		seenLinks.add(current);
		const linkTarget = readlinkSync(current);
		if (linkChain && !isOutsideRepository(current)) {
			linkChain.push({ path: toPosix(path.relative(REPO_ROOT, current)), target: linkTarget });
		}
		const target = path.isAbsolute(linkTarget)
			? linkTarget
			: path.resolve(path.dirname(current), linkTarget);
		return resolveFilesystemPath(
			path.join(target, ...segments.slice(index + 1)),
			seenLinks,
			depth + 1,
			linkChain
		);
	}
	return current;
}

function logicalInputPath(arg: string, baseDirectory: string, origin: string): string {
	if (arg === '') {
		fail(
			`Empty path in ${origin}.`,
			'  An empty string is not a file. Pass no arguments for the whole project, or use\n' +
				'  --files-from - for a list that may legitimately be empty.'
		);
	}
	if (/[\r\n]/.test(arg)) {
		fail(
			`Newline inside a single path argument (${origin}): ${JSON.stringify(arg.slice(0, 40))}`,
			"  A computed list arrived as one positional argument. Pipe Git's native NUL records instead."
		);
	}

	const invocationBase = path.resolve(baseDirectory);
	const absolute = path.resolve(invocationBase, arg);
	let entry;
	try {
		entry = lstatSync(absolute);
	} catch (error) {
		if (isMissingPathError(error)) {
			fail(`No such file (${origin}): ${formatPathForDiagnostic(arg)}`);
		}
		throw error;
	}

	const fromInvocation = path.relative(invocationBase, absolute);
	const insideInvocation =
		fromInvocation === '' ||
		(fromInvocation !== '..' &&
			!fromInvocation.startsWith(`..${path.sep}`) &&
			!path.isAbsolute(fromInvocation));
	const named =
		!path.isAbsolute(arg) || insideInvocation
			? path.resolve(resolveFilesystemPath(invocationBase), fromInvocation)
			: absolute;
	if (isOutsideRepository(named)) {
		fail(
			`Path is outside the repository (${origin}): ${formatPathForDiagnostic(arg)}`,
			`  Repo root: ${formatPathForDiagnostic(REPO_ROOT)}`
		);
	}
	void entry;
	return toPosix(path.relative(REPO_ROOT, named));
}

function checkedRealpath(
	absolute: string,
	logical: string,
	origin: string,
	linkChain?: Array<{ path: string; target: string }>
): string {
	try {
		const target = resolveFilesystemPath(absolute, new Set(), 0, linkChain);
		if (isOutsideRepository(target)) {
			fail(
				`Path target is outside the repository (${origin}): ${formatPathForDiagnostic(logical)}`,
				`  Repo root: ${formatPathForDiagnostic(REPO_ROOT)}`
			);
		}
		return target;
	} catch (error) {
		const code = (error as NodeJS.ErrnoException | null)?.code;
		if (code === 'ENOENT' || code === 'ELOOP') {
			fail(`Broken or cyclic symbolic link (${origin}): ${formatPathForDiagnostic(logical)}`);
		}
		throw error;
	}
}

function directoryAncestors(directory: string): Set<string> {
	const ancestors = new Set<string>();
	let current = directory;
	while (!isOutsideRepository(current)) {
		ancestors.add(current);
		if (current === REPO_ROOT) break;
		current = path.dirname(current);
	}
	return ancestors;
}

function matchingPlaceholderObject(
	logical: string,
	entry: GitInventoryEntry | undefined,
	gitEnv: NodeJS.ProcessEnv
): boolean {
	if (entry?.mode !== '120000' || !entry.objectId) return false;
	try {
		return hashWorktreeFileNoFilters(logical, REPO_ROOT, gitEnv) === entry.objectId;
	} catch {
		return false;
	}
}

function metadataPlaceholder(
	logical: string,
	entry: GitInventoryEntry,
	inventory: GitInventoryEntry[]
): { target: string; inventoryPaths: string[]; placeholderTarget: string } | undefined {
	const bytes = readFileSync(path.join(REPO_ROOT, logical));
	let target: string | undefined;
	let placeholderTarget: string | undefined;
	if (logical === 'CLAUDE.md' && bytes.equals(Buffer.from('AGENTS.md'))) {
		target = 'AGENTS.md';
		placeholderTarget = 'AGENTS.md';
	} else {
		const match = /^\.claude\/skills\/([^/]+)$/.exec(logical);
		if (match) {
			placeholderTarget = `../../.agents/skills/${match[1]}`;
			if (bytes.equals(Buffer.from(placeholderTarget))) target = `.agents/skills/${match[1]}`;
		}
	}
	if (!target || !placeholderTarget) return undefined;

	const represented = inventory
		.filter((candidate) => candidate.path === target || candidate.path.startsWith(`${target}/`))
		.map((candidate) => candidate.path);
	if (represented.length === 0) return undefined;
	const absoluteTarget = path.join(REPO_ROOT, target);
	const canonical = checkedRealpath(absoluteTarget, target, 'metadata placeholder');
	if (toPosix(path.relative(REPO_ROOT, canonical)) !== target) return undefined;
	const targetStat = statSync(canonical);
	if (!targetStat.isFile() && !targetStat.isDirectory()) return undefined;
	return {
		target,
		inventoryPaths: [...new Set([entry.path, ...represented])],
		placeholderTarget
	};
}

/**
 * Eine Eingabe bleibt unter ihrem logischen Alias benannt. Das separat validierte Ziel
 * bestimmt nur, welche Bytes gelesen werden und welches Compiler-Projekt zuständig ist.
 */
export function resolveInputRecords(
	raw: string[],
	origin: string,
	baseDirectory = process.cwd(),
	inventoryProvider: InventoryProvider = () => getGitInventory(REPO_ROOT),
	options: ResolverOptions = {}
): ResolvedInput[] {
	const out = new Map<string, ResolvedInput>();
	const inventory = inventoryProvider(REPO_ROOT);
	const byPath = new Map(inventory.map((entry) => [entry.path, entry]));
	const gitEnv = options.gitEnv ?? sanitizedGitEnv();

	const add = (record: ResolvedInput): void => {
		const previous = out.get(record.path);
		if (previous && previous.target !== record.target) {
			fail(`Logical path resolved to multiple targets: ${formatPathForDiagnostic(record.path)}.`);
		}
		if (!previous) {
			out.set(record.path, record);
			return;
		}
		const chain = new Map(previous.linkChain.map((link) => [`${link.path}\0${link.target}`, link]));
		for (const link of record.linkChain) chain.set(`${link.path}\0${link.target}`, link);
		out.set(record.path, {
			...previous,
			kind: previous.kind === 'symlink' || record.kind === 'symlink' ? 'symlink' : previous.kind,
			linkChain: [...chain.values()],
			inventoryPaths: [...new Set([...previous.inventoryPaths, ...record.inventoryPaths])],
			formatterLinkNoop: previous.formatterLinkNoop && record.formatterLinkNoop
		});
	};

	const directChildren = (
		physicalDirectory: string
	): Map<string, GitInventoryEntry | undefined> => {
		const relativeDirectory = toPosix(path.relative(REPO_ROOT, physicalDirectory));
		const prefix = relativeDirectory === '' ? '' : `${relativeDirectory}/`;
		const children = new Map<string, GitInventoryEntry | undefined>();
		for (const candidate of inventory) {
			if (prefix && !candidate.path.startsWith(prefix)) continue;
			const suffix = prefix === '' ? candidate.path : candidate.path.slice(prefix.length);
			if (!suffix) continue;
			const separator = suffix.indexOf('/');
			const name = separator < 0 ? suffix : suffix.slice(0, separator);
			const exact = separator < 0 ? candidate : undefined;
			if (!children.has(name) || exact) children.set(name, exact);
		}
		return children;
	};

	const inspect = (
		logical: string,
		physical: string,
		inventoryEntry: GitInventoryEntry | undefined,
		ancestors: Set<string>,
		formatterLinkNoop: boolean
	): void => {
		if (isOutsideRepository(path.join(REPO_ROOT, logical)) || isOutsideRepository(physical)) {
			fail(`Expanded path is outside the repository: ${formatPathForDiagnostic(logical)}.`);
		}
		if (isNeverWalked(logical)) return;

		const logicalAbsolute = path.join(REPO_ROOT, logical);
		let entry;
		try {
			entry = lstatSync(logicalAbsolute);
		} catch (error) {
			if (isMissingPathError(error)) {
				fail(`Expanded path disappeared: ${formatPathForDiagnostic(logical)}.`);
			}
			throw error;
		}

		if (inventoryEntry?.mode === '160000') {
			const chain: Array<{ path: string; target: string }> = [];
			const canonical = checkedRealpath(logicalAbsolute, logical, origin, chain);
			add({
				path: logical,
				target: toPosix(path.relative(REPO_ROOT, canonical)),
				kind: 'gitlink',
				linkChain: chain,
				inventoryPaths: [...new Set([...chain.map((link) => link.path), inventoryEntry.path])],
				formatterLinkNoop: true,
				gitObjectId: inventoryEntry.objectId,
				gitEnv
			});
			return;
		}

		if (
			!entry.isSymbolicLink() &&
			entry.isFile() &&
			matchingPlaceholderObject(logical, inventoryEntry, gitEnv)
		) {
			const metadata =
				options.allowMetadataPlaceholders && inventoryEntry
					? metadataPlaceholder(logical, inventoryEntry, inventory)
					: undefined;
			add({
				path: logical,
				target: metadata?.target ?? toPosix(path.relative(REPO_ROOT, physical)),
				kind: metadata ? 'git-metadata-placeholder' : 'git-symlink-placeholder',
				linkChain: [],
				inventoryPaths: metadata?.inventoryPaths ?? [inventoryEntry!.path],
				formatterLinkNoop: true,
				gitObjectId: inventoryEntry!.objectId,
				placeholderTarget: metadata?.placeholderTarget,
				gitEnv
			});
			return;
		}

		const chain: Array<{ path: string; target: string }> = [];
		const canonical = checkedRealpath(logicalAbsolute, logical, origin, chain);
		const targetStat = statSync(canonical);
		const target = toPosix(path.relative(REPO_ROOT, canonical));
		const targetInventory = byPath.get(target);
		const inventoryPaths = [
			...chain.map((link) => link.path),
			...(targetInventory ? [targetInventory.path] : [])
		];

		if (targetInventory?.mode === '160000') {
			add({
				path: logical,
				target,
				kind: 'gitlink',
				linkChain: chain,
				inventoryPaths: [...new Set(inventoryPaths)],
				formatterLinkNoop: true,
				gitObjectId: targetInventory.objectId,
				gitEnv
			});
			return;
		}

		if (targetStat.isDirectory()) {
			if (ancestors.has(canonical)) {
				fail(`Symbolic-link directory cycle: ${formatPathForDiagnostic(logical)}.`);
			}
			const nextAncestors = new Set(ancestors).add(canonical);
			let matched = false;
			for (const [name, childEntry] of directChildren(canonical)) {
				matched = true;
				inspect(
					logical === '' ? name : `${logical}/${name}`,
					path.join(canonical, name),
					childEntry,
					nextAncestors,
					formatterLinkNoop
				);
			}
			if (!matched) {
				fail(
					`Directory contains no files to check (${origin}): ${formatPathForDiagnostic(logical)}`
				);
			}
			return;
		}

		if (!targetStat.isFile()) {
			fail(`Named path is not a regular file: ${formatPathForDiagnostic(logical)}.`);
		}
		add({
			path: logical,
			target,
			kind: chain.length > 0 ? 'symlink' : 'file',
			linkChain: chain,
			inventoryPaths: [...new Set(inventoryPaths.length > 0 ? inventoryPaths : [target])],
			formatterLinkNoop
		});
	};

	for (const arg of raw) {
		const logical = logicalInputPath(arg, baseDirectory, origin);
		const absolute = path.join(REPO_ROOT, logical);
		const entry = lstatSync(absolute);
		const inventoryEntry = byPath.get(logical);
		if (
			inventoryEntry?.mode === '160000' ||
			(!entry.isSymbolicLink() &&
				entry.isFile() &&
				matchingPlaceholderObject(logical, inventoryEntry, gitEnv))
		) {
			inspect(logical, absolute, inventoryEntry, directoryAncestors(path.dirname(absolute)), true);
			continue;
		}
		const chain: Array<{ path: string; target: string }> = [];
		const canonical = checkedRealpath(absolute, logical, origin, chain);
		const targetStat = statSync(canonical);
		const directLink = entry.isSymbolicLink();
		const target = toPosix(path.relative(REPO_ROOT, canonical));
		const targetInventory = byPath.get(target);
		if (targetInventory?.mode === '160000') {
			add({
				path: logical,
				target,
				kind: 'gitlink',
				linkChain: chain,
				inventoryPaths: [...new Set([...chain.map((link) => link.path), targetInventory.path])],
				formatterLinkNoop: true,
				gitObjectId: targetInventory.objectId,
				gitEnv
			});
			continue;
		}
		if (targetStat.isDirectory()) {
			const ancestors = directoryAncestors(canonical);
			let matched = false;
			for (const [name, childEntry] of directChildren(canonical)) {
				matched = true;
				inspect(
					logical === '' ? name : `${logical}/${name}`,
					path.join(canonical, name),
					childEntry,
					ancestors,
					directLink
				);
			}
			if (!matched) {
				fail(`Directory contains no files to check (${origin}): ${formatPathForDiagnostic(arg)}`);
			}
		} else {
			inspect(
				logical,
				canonical,
				inventoryEntry,
				directoryAncestors(path.dirname(canonical)),
				directLink
			);
		}
	}

	return [...out.values()].sort((left, right) => left.path.localeCompare(right.path));
}

/** Kompatible String-Abbildung: ein Pfadstring bedeutet immer den logischen Repository-Namen. */
export function resolveInputs(
	raw: string[],
	origin: string,
	baseDirectory = process.cwd(),
	directoryPaths: (directory: string) => string[] = repositoryPaths,
	followSymbolicLinks = true
): string[] {
	const defaultInventory =
		directoryPaths === repositoryPaths ? getGitInventory(REPO_ROOT) : undefined;
	const provider: InventoryProvider = (directory) =>
		defaultInventory ?? directoryPaths(directory).map((file) => ({ path: file }));
	if (!followSymbolicLinks) {
		const paths: string[] = [];
		for (const arg of raw) {
			const logical = logicalInputPath(arg, baseDirectory, origin);
			if (lstatSync(path.join(REPO_ROOT, logical)).isSymbolicLink()) paths.push(logical);
			else {
				paths.push(
					...resolveInputRecords([arg], origin, baseDirectory, provider).map(
						(record) => record.path
					)
				);
			}
		}
		return [...new Set(paths)].sort();
	}
	return resolveInputRecords(raw, origin, baseDirectory, provider).map((record) => record.path);
}

/** NUL-separated paths from a file, or from stdin with "-". An empty list is legal. */
function readFilesFrom(source: string): string[] {
	const bytes =
		source === '-'
			? readFileSync(0)
			: existsSync(path.resolve(source))
				? readFileSync(path.resolve(source))
				: fail(`--files-from: no such file: ${formatPathForDiagnostic(source)}`);
	// `ignoreBOM: true` keeps U+FEFF visible so the explicit ambiguity check below runs.
	const raw = decodeUtf8(bytes, '--files-from contains bytes that are not valid UTF-8.');

	if (raw.charCodeAt(0) === 0xfeff) {
		fail(
			'--files-from must be UTF-8 without a byte-order mark.',
			'  A leading U+FEFF is ambiguous with a repository filename. Write BOM-less UTF-8.'
		);
	}

	if (raw === '') return [];
	const records = raw.split('\0');
	if (records.at(-1) === '') records.pop();
	if (records.some((record) => record === '')) {
		fail('--files-from contains an empty path record.');
	}
	return records;
}

// ===========================================================================
// Ledger — one routing table, one accounting of what actually ran
// ===========================================================================

export function isIgnoredPath(file: string): boolean {
	return CONFIG.ignorePaths.some((prefix) => file.startsWith(prefix));
}

/**
 * Which checks are responsible for a repo-relative path. The ONLY place a file set is
 * derived from the path itself, so a check can no longer disagree with the ledger about
 * its own scope, and a new check has to declare a route to be accounted for.
 *
 * Prettier is the one route that is not a path predicate, because the mapping from
 * filename to parser belongs to Prettier and moves when Prettier moves. It is resolved
 * by prettierFormattableFiles() below and reaches the ledger the same way every other
 * route does, through filesFor().
 */
export const ROUTES = {
	misspell: (f: string) => !CONFIG.misspell.ignore.some((i) => f.includes(i)),
	'banned-patterns': (f: string) => /\.(svelte|ts)$/.test(f) && f.startsWith('src/'),
	'literal-control-char': (f: string) => /\.(md|txt)$/.test(f) && !f.startsWith('scratch/'),
	'knowledge-placement': (f: string) => matchesKnowledgeCandidate(knowledgePolicy, f),
	eslint: (f: string) => /\.(js|ts|svelte)$/.test(f),
	// The old gate was `jsTsSvelteFiles.length === 0 && svelteFiles.length === 0`;
	// svelteFiles is a subset of jsTsSvelteFiles, so the second clause was dead.
	'svelte-check': (f: string) =>
		(/^(src|test|tests)\//.test(f) || /^vite\.config\.(js|ts)$/.test(f)) &&
		/\.(js|ts|svelte)$/.test(f) &&
		!f.startsWith('src/lib/convex/') &&
		!/^src\/service-worker(?:\/|\.|$)/.test(f),
	'skill-types': (f: string) =>
		f === '.agents/skills/tsconfig.json' ||
		f === '.agents/skills/upstream-report/tsconfig.json' ||
		(f.startsWith('.agents/skills/') && f.includes('/scripts/') && f.endsWith('.ts')),
	convex: (f: string) => f.startsWith('src/lib/convex/')
} as const;

/** The ignore files Prettier's CLI consults unless --ignore-path overrides them. */
const PRETTIER_IGNORE_FILES = ['.gitignore', '.prettierignore'];

/**
 * The files Prettier would actually format, answered by Prettier.
 *
 * This used to be an extension grammar maintained here by hand, which is a copy of a
 * table Prettier owns and was wrong wherever the two had drifted apart: README.markdown,
 * .babelrc, .geojson and .mjml are all formatted by Prettier and none of them matched, so
 * a file-scoped run skipped them and reported success.
 *
 * Configuration resolution is part of the routing answer. A parser override can make a
 * filename with no built-in language format-capable, and classifying with `resolveConfig:
 * false` silently removed it from a computed list that the real CLI rejected as unformatted.
 * The config and plugins are project-owned executable inputs that the formatter itself runs;
 * classification must use the same ones. Ignore files are consulted for the same reason: a
 * file the command skips is not work this run may claim.
 */
export async function prettierFormattableFiles(
	files: string[],
	cwd = REPO_ROOT
): Promise<string[]> {
	const candidates = files.filter((file) => !isPrettierAlwaysIgnoredPath(file));
	if (candidates.length === 0) return [];
	const ignorePath = PRETTIER_IGNORE_FILES.map((file) => path.join(cwd, file));
	// `getFileInfo` reads ignore files and may load parser metadata. Starting one promise per
	// path made a full-format preflight retain an ignored generated tree at once and roughly
	// doubled the peak memory of direct Prettier in the reproducer. Keep only as many
	// classifications active as the host can run in parallel; result slots preserve order.
	const infos: Array<Awaited<ReturnType<typeof getFileInfo>> | undefined> = Array.from({
		length: candidates.length
	});
	let cursor = 0;
	await Promise.all(
		Array.from({ length: Math.min(candidates.length, availableParallelism()) }, async () => {
			while (cursor < candidates.length) {
				const index = cursor++;
				infos[index] = await getFileInfo(path.resolve(cwd, candidates[index]!), {
					ignorePath,
					resolveConfig: true
				});
			}
		})
	);
	return candidates.filter((file, index) => {
		const info = infos[index]!;
		if (info.ignored) return false;
		return info.inferredParser !== null;
	});
}

export function authoredTextFiles(files: string[]): string[] {
	return files.filter((file) => ROUTES['literal-control-char'](file) && !isIgnoredPath(file));
}

export function spellcheckFiles(files: string[]): string[] {
	return files.filter((file) => ROUTES.misspell(file) && !isIgnoredPath(file));
}

type CheckId = keyof typeof ROUTES | 'prettier';
const CHECK_IDS: CheckId[] = [...(Object.keys(ROUTES) as Array<keyof typeof ROUTES>), 'prettier'];
const LINT_CHECKS: CheckId[] = [
	'misspell',
	'banned-patterns',
	'literal-control-char',
	'knowledge-placement',
	'prettier',
	'eslint'
];
const TYPE_CHECKS: CheckId[] = ['svelte-check', 'skill-types', 'convex'];

type Mode = 'files' | 'staged' | 'full';

/** Keep structured command lines below Windows' process argument limit. */
export function argumentBatches(
	files: string[],
	baseArguments: string[] = [],
	maxCharacters = 24_000,
	maxFiles = 100
): string[][] {
	const batches: string[][] = [];
	let batch: string[] = [];
	let characters = baseArguments.reduce((total, argument) => total + argument.length + 1, 0);

	for (const file of files) {
		const added = file.length + 1;
		if (batch.length > 0 && (batch.length >= maxFiles || characters + added > maxCharacters)) {
			batches.push(batch);
			batch = [];
			characters = baseArguments.reduce((total, argument) => total + argument.length + 1, 0);
		}
		batch.push(file);
		characters += added;
	}
	if (batch.length > 0) batches.push(batch);
	return batches;
}

export function usesAssertOnlyChecks(ciMode: boolean, mode: Mode): boolean {
	return ciMode || mode === 'staged';
}
type Outcome =
	| { kind: 'ran'; files: number | 'project' }
	| { kind: 'skipped'; reason: string; suppressed: boolean };

/**
 * What the run actually did. The success banner is printed FROM this, so "All checks
 * passed!" can no longer be a claim with nothing behind it.
 *
 * `suppressed` separates "this check had files but was switched off" (--scope, or
 * misspell not installed) from "this check had no files". Only the second counts
 * against a zero-work run. Conflating them would red-flag a legitimate `--scope types`
 * run on a docs-only list, and a gate that cries wolf gets bypassed.
 */
class Ledger {
	readonly named: number;
	readonly records: ResolvedInput[];
	readonly files: string[];
	readonly ignored: string[];
	private readonly formattable: Set<string>;
	private readonly outcomes = new Map<string, Outcome>();
	private readonly honestNoWork: string[] = [];

	constructor(
		readonly mode: Mode,
		inputs: ResolvedInput[],
		/** The inputs Prettier reported a parser for. See prettierFormattableFiles(). */
		formattable: string[] = []
	) {
		this.named = inputs.length;
		this.ignored = inputs.map((input) => input.path).filter(isIgnoredPath);
		this.records = inputs.filter((input) => !this.ignored.includes(input.path));
		this.files = this.records.map((input) => input.path);
		this.formattable = new Set(formattable);
	}

	recordsFor(id: CheckId): ResolvedInput[] {
		const contentRecords = this.records.filter(
			(record) => record.kind !== 'git-metadata-placeholder' && record.kind !== 'gitlink'
		);
		if (id === 'prettier') {
			return contentRecords.filter(
				(record) => !record.formatterLinkNoop && this.formattable.has(record.path)
			);
		}
		if (id === 'svelte-check' || id === 'skill-types' || id === 'convex') {
			return contentRecords.filter((record) => ROUTES[id](record.target));
		}
		return contentRecords.filter((record) => ROUTES[id](record.path));
	}

	filesFor(id: CheckId): string[] {
		return this.recordsFor(id).map((record) => record.path);
	}

	ran(id: string, files: number | 'project' = 'project'): void {
		this.outcomes.set(id, { kind: 'ran', files });
	}

	skipped(id: string, reason: string, suppressed = false): void {
		this.outcomes.set(id, { kind: 'skipped', reason, suppressed });
	}

	/**
	 * Vermerkt einen Grund, aus dem dieser Lauf berechtigt keine Sourcebytes prüfen konnte.
	 *
	 * Ein Format-Scope darf melden, dass Prettier keinen benannten Pfad formatiert. Gelöschte
	 * staged Pfade und vollständig validierte Gitlinks tragen ebenfalls keine Sourcebytes;
	 * das gilt auch für Mischungen ausschließlich aus diesen Kategorien. Andere Fälle dürfen
	 * die Nullarbeits-Invariante nicht umgehen.
	 */
	noWork(reason: string): void {
		this.honestNoWork.push(reason);
	}

	/**
	 * Did a FILE-SCOPED check actually consume the caller's files? The always-on
	 * project checks (oxlint, build-emails, atmn) are deliberately not counted: they
	 * run no matter what you pass, so they can never earn green on the caller's behalf.
	 * That is exactly what let a zero-file run scroll plausible output past everyone.
	 */
	private consumedAnything(): boolean {
		return CHECK_IDS.some((id) => {
			const outcome = this.outcomes.get(id);
			return outcome?.kind === 'ran' && outcome.files !== 0;
		});
	}

	private suppressedWork(): boolean {
		return [...this.outcomes.values()].some((o) => o.kind === 'skipped' && o.suppressed);
	}

	/** The invariant: name files, and the run may only be green if it can point at work it did on them. */
	assertWorkPerformed(scopeLabel: string): void {
		if (this.mode === 'full') {
			// The full-project version of this same bug: if a project glob ever breaks,
			// CI prints "Scanned 0 files — no banned patterns found" and goes green.
			for (const [id, outcome] of this.outcomes) {
				if (outcome.kind === 'ran' && outcome.files === 0) {
					fail(`Full-project run: "${id}" matched 0 files — its project glob is broken.`);
				}
			}
			return;
		}

		if (this.consumedAnything()) return;

		// Zero work on the named files. A few reasons are honest; anything else is the bug.
		const honest: string[] = [...this.honestNoWork];
		if (this.named > 0 && this.ignored.length === this.named) {
			honest.push(`all ${this.named} input(s) are excluded by CONFIG.ignorePaths`);
		}
		if (this.suppressedWork()) {
			honest.push(`every check covering them is switched off (scope: ${scopeLabel})`);
		}

		if (honest.length === 0) {
			fail(
				`${this.named} file(s) named, and no check ran over any of them.`,
				`  No check in the active scope (${scopeLabel}) is responsible for them, so nothing\n` +
					'  was verified.\n' +
					'  A run that checks nothing must not report success.'
			);
		}

		console.log(`${colors.yellow}NO WORK: ${honest.join('; ')}.${colors.reset}`);
	}

	summary(): void {
		for (const [id, outcome] of this.outcomes) {
			const detail =
				outcome.kind === 'skipped'
					? `${colors.yellow}skipped — ${outcome.reason}${colors.reset}`
					: outcome.files === 'project'
						? 'whole project'
						: `${outcome.files} file(s)`;
			console.log(`  ${id.padEnd(16)} ${detail}`);
		}
		if (this.ignored.length > 0) {
			console.log(
				`  ${'(ignored)'.padEnd(16)} ${this.ignored.length} input(s) — CONFIG.ignorePaths`
			);
		}
	}
}

// ===========================================================================

function parseCli() {
	const parsed = (() => {
		try {
			return parseArgs({
				args: Bun.argv,
				options: {
					staged: { type: 'boolean', default: false },
					ci: { type: 'boolean', default: false },
					scope: { type: 'string' },
					'files-from': { type: 'string' }
				},
				// Was strict:false, which swallowed every typo. `--scop lint` leaked its
				// VALUE into the positionals as a bogus file, and `--CI` silently downgraded
				// CI's assert mode into fix mode: prettier switched from --check to --write
				// and REWROTE the source it was supposed to be asserting on, then reported
				// success. An unrecognized flag is now a hard error.
				strict: true,
				allowPositionals: true
			});
		} catch (error) {
			return fail(`Bad arguments: ${(error as Error).message.split('. To specify')[0]}`, USAGE);
		}
	})();

	const { values, positionals } = parsed;
	const stagedOnly = values.staged ?? false;
	const ciMode = values.ci ?? false;
	const scope = values.scope as 'lint' | 'types' | 'format' | 'compat' | undefined;
	const filesFrom = values['files-from'];

	if (scope && !['lint', 'types', 'format', 'compat'].includes(scope)) {
		fail(`Invalid --scope value: "${scope}". Use "lint", "types", "format", or "compat".`);
	}

	// Skip first two positionals (bun runtime + script path)
	const rawPositionals = positionals.slice(2);

	if (filesFrom !== undefined && rawPositionals.length > 0) {
		fail('--files-from and explicit file arguments are mutually exclusive.');
	}
	if (stagedOnly && (rawPositionals.length > 0 || filesFrom !== undefined)) {
		fail(
			'--staged cannot be combined with file arguments.',
			'  They select different sets. Positionals used to win silently, so --staged was\n' +
				'  ignored and the auto-fixes were never re-staged.'
		);
	}

	// Mode follows what was ASKED FOR, not what survived filtering.
	const mode: Mode =
		filesFrom !== undefined || rawPositionals.length > 0 ? 'files' : stagedOnly ? 'staged' : 'full';

	if (scope === 'compat' && mode !== 'full') {
		fail(
			'--scope compat only supports a full-project run; omit --staged, file arguments, and --files-from.'
		);
	}

	// A staged run must end by proving the checked bytes are still the staged bytes, and
	// that closing argument belongs to the lint-and-types path that owns it. Rather than
	// spread it over a second exit, the combination is refused, and --staged stays a lint
	// consumer.
	//
	// `--files-from` over the staged names is not a substitute, and the diagnostic must not
	// read as one. It names paths, and every checker then reads the working tree: stage an
	// unformatted file, format only the working copy, and a gate built that way passes while
	// the unformatted blob is what gets committed. This scope is a push gate over paths that
	// exist on disk, and there is no index-exact formatting mode.
	if (scope === 'format' && mode === 'staged') {
		fail(
			'--scope format does not support --staged.',
			'  It formats a full project or a named file list, always as the files are on disk.\n' +
				'  A gate over index bytes belongs to --staged, which the lint scope owns.'
		);
	}

	return { ciMode, scope, mode, rawPositionals, filesFrom };
}

/**
 * Run a command and exit if it fails
 */
async function runCommand(
	command: string,
	args: string[],
	options?: SanitizedCommandOptions
): Promise<void> {
	let result;
	try {
		result = await runSanitizedCommand(command, args, options);
	} catch {
		console.error(
			`${colors.red}Command could not start: ${sanitizeTerminalField(command)}${colors.reset}`
		);
		process.exit(1);
	}

	if (result.status !== 0) {
		const invocation = sanitizeTerminalField(`${command} ${args.join(' ')}`);
		console.error(`${colors.red}Command failed: ${invocation}${colors.reset}`);
		process.exit(result.status ?? 1);
	}
}

/**
 * Every glob metacharacter, spelled as a one-character class rather than backslash-escaped.
 *
 * Prettier resolves an argument as a path first and expands it as a glob only once that
 * path is gone, which is what lets a vanished file quietly match a neighbour: measured with
 * Prettier 3.9.5, `scripts/[ab].ts` checks `scripts/a.ts` and exits 0 after the named file
 * is deleted, while the escaped form exits 2 with "No files matching the pattern".
 *
 * `+` is in the list because it quantifies whatever precedes it, and after an escape that
 * is the class rather than a literal: measured, `[+.ts` escaped to `[[]+.ts` matched the
 * neighbouring `[.ts` and exited 0 while the requested file stayed unformatted.
 *
 * The escape cannot be a backslash. Prettier hands an unresolvable argument to
 * `normalizeToPosix`, which on Windows replaces every backslash with a slash
 * (prettier/internal/legacy-cli.mjs), so a backslash-escaped SvelteKit route such as
 * `src/routes/[[lang]]/(auth)/+page.svelte` would arrive with its escapes stripped and
 * match nothing. A character class survives that rewrite, and it is also inert to the
 * `path.resolve` Prettier runs before its own `lstat`, where a backslash is a separator.
 */
const GLOB_CLASS_ESCAPES = new Map<string, string>([
	['*', '[*]'],
	['+', '[+]'],
	['?', '[?]'],
	['[', '[[]'],
	['(', '[(]'],
	[')', '[)]'],
	['{', '[{]'],
	['}', '[}]'],
	['|', '[|]']
]);

/**
 * For a stable filesystem snapshot, turn a repository path into a glob pattern that can
 * only match that same path. Synchronized mutations between this check and child launch are
 * tracked in #875 and require a file-descriptor/stdin formatter path rather than more escaping.
 *
 * `!`, `]`, a literal backslash and a double quote take an extglob rather than a class.
 * `[!]` opens a negated class and the last two cannot appear inside one. `./` is not an
 * option for the `!`: measured with Prettier 3.9.5, `./!a[[]b[]].ts` still reads as a
 * negation, so a run whose named file had vanished matched every other root file and exited
 * 0, while `@(!)a[[]b[]].ts` exits 2 with "No files matching the pattern". A backslash and
 * a quote are unrepresentable in a Windows filename, so those two branches are reachable on
 * POSIX alone, where Prettier's `normalizeToPosix` is the identity.
 *
 * `]` is the one that has to be an extglob for a reason outside its own escape. The POSIX
 * form `[]]` is correct on its own, and it composes wrongly with the `{` and `}` classes
 * because fast-glob runs `micromatch.braces()` over the whole pattern before picomatch sees
 * it, and that pass reads the braces inside `[{]` and `[}]` as a brace expression. Measured
 * with Prettier 3.9.5: `[]][{][}].ts` selected the neighbouring `{}.ts` and reported it
 * clean, and `[{][]][}].ts` and `[{][}][]].ts` matched nothing at all. Over every ordered
 * triple of the ten metacharacters plus `!`, `\\` and `"`, the class form fails those three
 * and the extglob form fails none.
 */
export function prettierLiteralPattern(file: string): string {
	let pattern = '';
	for (const character of file) {
		if (character === '\\') pattern += '@(\\\\)';
		else if (character === '"') pattern += '@(\\")';
		else if (character === '!') pattern += '@(!)';
		else if (character === ']') pattern += '@(])';
		else pattern += GLOB_CLASS_ESCAPES.get(character) ?? character;
	}
	// The pattern is only unambiguous while no file is named exactly like it. Prettier
	// resolves an argument as a path before expanding it, so a repository holding both
	// `[ab].ts` and `[[]ab[]].ts` would check the second and report on the first. Nothing
	// downstream could tell, since the ledger counts the path that was asked for.
	if (pattern !== file && existsSync(path.join(REPO_ROOT, pattern))) {
		fail(
			`Two repository paths collide under formatter escaping: ${formatPathForDiagnostic(file)}`,
			`  Its escaped pattern names a second real file (${formatPathForDiagnostic(pattern)}),\n` +
				'  and Prettier would check that one instead. Rename either path.'
		);
	}
	return pattern;
}

/**
 * One formatter contract, whether the run names files or the whole project.
 *
 * Both invocations are built here so they cannot drift: the project run used to take
 * neither --ignore-unknown nor the plugins while the file-scoped run passed plugins on
 * the command line, so the two could disagree about what a given file even is. Neither
 * names a plugin now, because .prettierrc declares them once and the formatter reads it.
 * --ignore-unknown makes a path Prettier has no parser for a skip in both runs instead
 * of a hard error in one.
 */
export function prettierArguments(formatFlag: '--check' | '--write', files?: string[]): string[] {
	const invocation = ['prettier', formatFlag, '--ignore-unknown'];
	// Everything after the separator is a path. Without it Prettier reads a leading-dash
	// filename as an option, discards it with a warning, finds nothing left to check and
	// exits 0, so a repository file named "--anything.ts" is never looked at.
	return files === undefined
		? [...invocation, '.']
		: [...invocation, '--', ...files.map(prettierLiteralPattern)];
}

function assertRegularFormatterPaths(files: string[]): void {
	for (const file of files) {
		let entry;
		try {
			entry = lstatSync(path.join(REPO_ROOT, file));
		} catch (error) {
			if (isMissingPathError(error)) {
				fail(`Named path disappeared before formatter launch: ${formatPathForDiagnostic(file)}.`);
			}
			throw error;
		}
		if (!entry.isFile()) {
			fail(`Named formatter path is not a regular file: ${formatPathForDiagnostic(file)}.`);
		}
	}
}

function assertResolvedInputs(records: ResolvedInput[]): void {
	for (const record of records) {
		const absolute = path.join(REPO_ROOT, record.path);
		if (record.kind === 'git-symlink-placeholder' || record.kind === 'git-metadata-placeholder') {
			const entry = lstatSync(absolute);
			if (!entry.isFile()) {
				fail(
					`Git symbolic-link placeholder changed type: ${formatPathForDiagnostic(record.path)}.`
				);
			}
			if (
				!record.gitObjectId ||
				hashWorktreeFileNoFilters(record.path, REPO_ROOT, record.gitEnv ?? sanitizedGitEnv()) !==
					record.gitObjectId
			) {
				fail(
					`Git symbolic-link placeholder changed content: ${formatPathForDiagnostic(record.path)}.`
				);
			}
			if (record.kind === 'git-metadata-placeholder') {
				if (
					!record.placeholderTarget ||
					!readFileSync(absolute).equals(Buffer.from(record.placeholderTarget))
				) {
					fail(`Metadata pointer changed before launch: ${formatPathForDiagnostic(record.path)}.`);
				}
				const target = path.resolve(path.dirname(absolute), record.placeholderTarget);
				const canonical = checkedRealpath(target, record.path, 'metadata revalidation');
				if (toPosix(path.relative(REPO_ROOT, canonical)) !== record.target) {
					fail(`Metadata target changed before launch: ${formatPathForDiagnostic(record.path)}.`);
				}
				const targetStat = statSync(canonical);
				if (!targetStat.isFile() && !targetStat.isDirectory()) {
					fail(`Metadata target changed type: ${formatPathForDiagnostic(record.path)}.`);
				}
			}
			continue;
		}
		for (const link of record.linkChain) {
			const entry = lstatSync(path.join(REPO_ROOT, link.path));
			if (
				!entry.isSymbolicLink() ||
				readlinkSync(path.join(REPO_ROOT, link.path)) !== link.target
			) {
				fail(`Symbolic-link chain changed before launch: ${formatPathForDiagnostic(record.path)}.`);
			}
		}
		const target = checkedRealpath(absolute, record.path, 'revalidation');
		if (toPosix(path.relative(REPO_ROOT, target)) !== record.target) {
			fail(`Path target changed before launch: ${formatPathForDiagnostic(record.path)}.`);
		}
		if (record.kind === 'gitlink') {
			if (
				!record.gitObjectId ||
				gitlinkHeadObjectId(record.target, REPO_ROOT) !== record.gitObjectId
			) {
				fail(`Gitlink HEAD changed before launch: ${formatPathForDiagnostic(record.path)}.`);
			}
			continue;
		}
		if (!statSync(target).isFile()) {
			fail(`Path is no longer a regular file: ${formatPathForDiagnostic(record.path)}.`);
		}
	}
}

async function runPrettier(
	formatFlag: '--check' | '--write',
	files?: string[],
	records: ResolvedInput[] = [],
	fullPlan?: { traversal: string[]; formattable: string[] }
): Promise<void> {
	if (files === undefined) {
		assertResolvedInputs(records);
		if (fullPlan) {
			const traversal = prettierTraversalPaths(REPO_ROOT, true);
			const formattable = await prettierFormattableFiles(prettierProjectPaths(traversal));
			if (
				traversal.join('\0') !== fullPlan.traversal.join('\0') ||
				formattable.join('\0') !== fullPlan.formattable.join('\0')
			) {
				fail('Formatter traversal or parser classification changed before launch.');
			}
		}
		await runCommand('bun', prettierArguments(formatFlag));
		return;
	}
	const baseArguments = prettierArguments(formatFlag, []);
	const patterns = files.map(prettierLiteralPattern);
	let offset = 0;
	for (const batch of argumentBatches(patterns, baseArguments)) {
		const batchFiles = files.slice(offset, offset + batch.length);
		const batchRecords = records.slice(offset, offset + batch.length);
		assertResolvedInputs(batchRecords);
		assertRegularFormatterPaths(batchFiles);
		const classified = await prettierFormattableFiles(batchFiles);
		if (classified.join('\0') !== batchFiles.join('\0')) {
			fail('Formatter parser classification changed before launch.');
		}
		offset += batch.length;
		await runCommand('bun', [...baseArguments, ...batch]);
	}
}

/**
 * The compatibility child gets a scrubbed environment, not an isolated one. Isolating here
 * would be irreversible: `isolatedGitEnv()` blanks the global and system config paths, and a
 * child cannot recover what its own environment no longer names. The checker needs that
 * configuration for its explicit baseline fetch, which relies on `url.*.insteadOf`, the
 * credential helper, the proxy and the CA bundle. Measured through this wrapper, a baseline
 * reachable only through a rewrite rule went unfetched: CI failed closed with "is
 * unreachable" and a local run fell back to the trunk and certified a different baseline.
 * Isolation belongs to the child, which applies it per call. Partial-clone lazy reads remain
 * isolated and can fail closed when they need external transport configuration; see #863 and
 * `isolatedGitEnv()` in `convex-consumer-compat.ts`.
 */
export function compatibilityInvocation(ciMode = false) {
	const env = sanitizedGitEnv();
	if (ciMode) env.CI = 'true';
	return {
		command: process.execPath,
		args: ['scripts/convex-consumer-compat.ts'],
		options: { env } satisfies SanitizedCommandOptions
	};
}

/**
 * Check if misspell is installed (cross-platform via Bun.which)
 */
function hasMisspell(): boolean {
	return Bun.which('misspell') !== null;
}

/**
 * Print section header
 */
function printHeader(step: number, title: string): void {
	console.log(`${colors.bold}${step}. ${title}${colors.reset}`);
	console.log('======================================================');
}

/** The only path to a zero exit code. */
function finish(ledger: Ledger, scopeLabel: string): void {
	ledger.assertWorkPerformed(scopeLabel);
	console.log('======================================================');
	console.log(`${colors.green}All checks passed!${colors.reset}`);
	ledger.summary();
	console.log('======================================================');
	process.exitCode = 0;
}

export function literalControlCharacterViolations(file: string, text: string): string[] {
	return findLiteralControlCharacters(text).map(
		(finding) =>
			`${file}:${finding.line}:${finding.column + 1}: ${finding.data.codepoint} (${finding.data.category}) is written as a literal character. Remove it or replace it with visible whitespace; inside a string or template, write ${finding.data.escape}.`
	);
}

function changedSnapshotPaths(before: string[], after: string[]): string[] {
	const beforeSet = new Set(before);
	const afterSet = new Set(after);
	return [...new Set([...beforeSet, ...afterSet])]
		.filter((file) => beforeSet.has(file) !== afterSet.has(file))
		.sort();
}

function inventorySnapshot(entries: GitInventoryEntry[]): string[] {
	return entries.map((entry) => `${entry.path}\0${entry.mode ?? ''}\0${entry.objectId ?? ''}`);
}

function usesIgnoredDefaultSvelteKitOutDir(): boolean {
	const config = readFileSync(path.join(REPO_ROOT, 'svelte.config.js'), 'utf8');
	return (
		!/\boutDir\s*:/.test(config) && isGitIgnoredPath('.svelte-kit/static-checks-probe', REPO_ROOT)
	);
}

function existingInventoryEntries(
	entries: GitInventoryEntry[],
	origin: string
): GitInventoryEntry[] {
	return entries.filter((entry) => {
		try {
			lstatSync(path.join(REPO_ROOT, entry.path));
			return true;
		} catch (error) {
			if (!isMissingPathError(error)) throw error;
			if (entry.mode === '120000') {
				fail(`Git symbolic link is missing (${origin}): ${formatPathForDiagnostic(entry.path)}.`);
			}
			return false;
		}
	});
}

function assertMaterializedLinks(records: ResolvedInput[]): void {
	const placeholder = records.find((record) => record.kind === 'git-symlink-placeholder');
	if (placeholder) {
		fail(
			`Git symbolic link has no materialized source content: ${formatPathForDiagnostic(placeholder.path)}.`,
			'  The active checkout uses a regular placeholder for index mode 120000. Lint and type\n' +
				'  checks cannot inspect its target; enable symbolic links and check out the repository again.'
		);
	}
}

// Main execution
async function main(): Promise<void> {
	const { ciMode, scope, mode, rawPositionals, filesFrom } = parseCli();

	const shouldRunLint = !scope || scope === 'lint';
	const shouldRunTypes = !scope || scope === 'types';
	const scopedMode = mode === 'files' || mode === 'staged';
	const assertMode = usesAssertOnlyChecks(ciMode, mode);
	const scopeLabel = scope ?? 'lint + types';

	// Der Aufrufername wird vor dem chdir festgelegt; alle Ziele kommen aus einem Git-Inventar.
	let inputs: ResolvedInput[] = [];
	let stagedValidatedPaths: string[] = [];
	let stagedNoSourceReason: string | undefined;
	let stagedIndexFingerprint: string | undefined;
	let stagedEnv: NodeJS.ProcessEnv | undefined;
	if (mode === 'files') {
		const raw = filesFrom !== undefined ? readFilesFrom(filesFrom) : rawPositionals;
		if (filesFrom !== undefined && raw.length === 0) {
			console.log('No files to check (empty --files-from list)');
			process.exit(0);
		}
		assertSafePaths(raw);
		const baseDirectory = filesFrom !== undefined ? REPO_ROOT : process.cwd();
		const gitInventory = getGitInventory(REPO_ROOT);
		const gitEntries = new Map(gitInventory.map((entry) => [entry.path, entry]));
		const provider: InventoryProvider =
			scope === 'format'
				? (directory) => {
						// Prettiers Dateitraversal steigt in ausgecheckte Submodule ein. Die Gitlinks
						// bleiben zusätzlich im Inventar, damit der Resolver sie vorher atomar stoppt.
						const entries = prettierTraversalPaths(directory, false, REPO_ROOT).map(
							(file) => gitEntries.get(file) ?? { path: file }
						);
						const paths = new Set(entries.map((entry) => entry.path));
						for (const entry of gitInventory) {
							if (entry.mode === '160000' && !paths.has(entry.path)) entries.push(entry);
						}
						return entries;
					}
				: () => gitInventory;
		inputs = resolveInputRecords(
			raw,
			filesFrom !== undefined ? `--files-from ${filesFrom}` : 'arguments',
			baseDirectory,
			provider
		);
	}

	process.chdir(REPO_ROOT);

	if (mode === 'staged') {
		stagedEnv = stagedGitEnv(REPO_ROOT);
		stagedIndexFingerprint = activeGitIndexFingerprint(REPO_ROOT, stagedEnv);
		const stagedChanges = getStagedChanges(REPO_ROOT, stagedEnv);
		if (stagedChanges.length === 0) {
			console.log('No staged files to check');
			process.exit(0);
		}
		const stagedDeletedPaths = stagedChanges
			.filter((change) => change.status === 'D')
			.map((change) => change.path);
		const stagedIndexPaths = getStagedFiles(REPO_ROOT, stagedEnv);
		assertSafePaths([...stagedIndexPaths, ...stagedDeletedPaths]);
		const stagedInventory = getGitInventory(REPO_ROOT, stagedEnv, false);
		inputs =
			stagedIndexPaths.length > 0
				? resolveInputRecords(stagedIndexPaths, 'the git index', REPO_ROOT, () => stagedInventory, {
						gitEnv: stagedEnv
					})
				: [];
		const stagedInventoryPaths = new Set(stagedInventory.map((entry) => entry.path));
		const unstagedLink = inputs
			.flatMap((input) => input.linkChain)
			.find((link) => !stagedInventoryPaths.has(link.path));
		if (unstagedLink) {
			fail(
				`Symbolic-link chain path is absent from the active Git index: ${formatPathForDiagnostic(unstagedLink.path)}.`
			);
		}
		const unstagedTarget = inputs.find(
			(input) => input.kind === 'symlink' && !stagedInventoryPaths.has(input.target)
		);
		if (unstagedTarget) {
			fail(
				`Symbolic-link target is absent from the active Git index: ${formatPathForDiagnostic(unstagedTarget.path)}.`
			);
		}
		stagedValidatedPaths = [
			...new Set([...stagedIndexPaths, ...inputs.flatMap((input) => input.inventoryPaths)])
		];
		const cleanFiltered = stagedFilesWithCleanFilters(stagedValidatedPaths, REPO_ROOT, stagedEnv);
		if (cleanFiltered.length > 0) {
			fail(
				'Custom Git clean filters are unsupported in staged checks.',
				'  Remove the filter from checked paths, then stage the intended bytes and retry.'
			);
		}
		const deletedPathStillExists = stagedDeletedPaths.some((file) => {
			try {
				lstatSync(path.join(REPO_ROOT, file));
				return true;
			} catch (error) {
				if (isMissingPathError(error)) return false;
				throw error;
			}
		});
		const stagedMatches = stagedFilesMatchWorktree(stagedValidatedPaths, REPO_ROOT, stagedEnv);
		if (deletedPathStillExists || !stagedMatches) {
			fail(
				'Staged file contents differ from the worktree.',
				'  Run the checks in fix mode, review the result, stage the intended bytes,\n' +
					'  and retry the commit.'
			);
		}
		const stagedEntries = new Map(stagedInventory.map((entry) => [entry.path, entry]));
		const onlyDeletions = stagedChanges.every((change) => change.status === 'D');
		const onlyGitlinks = stagedChanges.every(
			(change) => change.status !== 'D' && stagedEntries.get(change.path)?.mode === '160000'
		);
		const onlyNoSourceChanges = stagedChanges.every(
			(change) => change.status === 'D' || stagedEntries.get(change.path)?.mode === '160000'
		);
		if (onlyDeletions) {
			stagedNoSourceReason = 'staged changes only delete paths absent from the final index';
		} else if (onlyGitlinks) {
			stagedNoSourceReason = 'staged changes only update verified gitlink object IDs';
		} else if (onlyNoSourceChanges) {
			stagedNoSourceReason =
				'staged changes contain verified gitlink updates and deletions without source files to check';
		}
	}

	if (scope === 'compat') {
		assertSafePaths(repositoryPaths());
		const ledger = new Ledger(mode, []);
		console.log('======================================================');
		console.log('Static Checks (full project — compat)');
		console.log('======================================================\n');
		printHeader(1, 'Convex consumer compatibility');
		const invocation = compatibilityInvocation(ciMode);
		await runCommand(invocation.command, invocation.args, invocation.options);
		ledger.ran('convex compat');
		console.log('\n');
		finish(ledger, scopeLabel);
		return;
	}

	const countFullFormatter = mode === 'full' && (scope === 'format' || shouldRunLint);
	let fullFormatPaths = countFullFormatter ? prettierTraversalPaths(REPO_ROOT, true) : [];
	let fullGitInventory: GitInventoryEntry[] = [];
	if (mode === 'full') {
		const gitInventory = getGitInventory(REPO_ROOT);
		fullGitInventory = gitInventory;
		const gitEntries = new Map(gitInventory.map((entry) => [entry.path, entry]));
		const gitlinks = gitInventory
			.filter((entry) => entry.mode === '160000')
			.map((entry) => `${entry.path}/`);
		const combined = [...gitInventory];
		for (const file of fullFormatPaths) {
			if (!gitEntries.has(file) && !gitlinks.some((prefix) => file.startsWith(prefix))) {
				combined.push({ path: file });
			}
		}
		const existing = existingInventoryEntries(combined, 'full repository inventory');
		inputs = resolveInputRecords(
			existing.map((entry) => entry.path),
			'the repository inventory',
			REPO_ROOT,
			() => existing,
			{ allowMetadataPlaceholders: true }
		);
	}
	assertSafePaths(inputs.flatMap((input) => [input.path, input.target]));
	if (scope !== 'format') assertMaterializedLinks(inputs);

	const prettierInputs = prettierProjectPaths(
		(countFullFormatter ? fullFormatPaths : inputs.map((input) => input.path)).filter(
			(file) => !inputs.find((input) => input.path === file)?.formatterLinkNoop
		),
		REPO_ROOT,
		scopedMode
	);
	let formattable = await prettierFormattableFiles(prettierInputs);
	assertSafePaths(formattable);
	const ledger = new Ledger(mode, inputs, formattable);
	const gitlinkInputs = inputs.filter((input) => input.kind === 'gitlink');
	if (gitlinkInputs.length > 0) assertResolvedInputs(gitlinkInputs);
	if (stagedNoSourceReason) ledger.noWork(stagedNoSourceReason);
	if (mode === 'files' && inputs.length > 0 && gitlinkInputs.length === inputs.length) {
		ledger.noWork(
			`${inputs.length === 1 ? 'verified gitlink' : 'verified gitlinks'} without source files to check`
		);
	}

	console.log('======================================================');
	console.log(
		mode === 'full'
			? `Static Checks (full project — ${scopeLabel})`
			: `Static Checks (${ledger.named} ${mode === 'staged' ? 'staged' : 'specified'} files — ${scopeLabel})`
	);
	console.log('======================================================\n');

	let step = 1;
	if (scope === 'format') {
		printHeader(step, 'Code formatting');
		const files = ledger.filesFor('prettier');
		if (!scopedMode) {
			if (files.length === 0) {
				fail('Full-project format scope found no supported, nonignored files.');
			}
			await runPrettier('--check', undefined, ledger.records, {
				traversal: fullFormatPaths,
				formattable
			});
			ledger.ran('prettier', files.length);
		} else if (files.length > 0) {
			await runPrettier('--check', files, ledger.recordsFor('prettier'));
			ledger.ran('prettier', files.length);
		} else {
			// Prettier is the only check in this scope, so it can answer for the whole run:
			// it would skip every named file, either because it has no parser for it or
			// because .prettierignore or .gitignore excludes it. Reporting that plainly is
			// honest; failing would make a caller that passes a mixed file list unusable.
			console.log(
				`No formatter work: Prettier formats none of the ${ledger.named} named file(s) ` +
					'(unknown file type, symbolic link, or excluded by .prettierignore or .gitignore).'
			);
			ledger.ran('prettier', 0);
			ledger.noWork(`Prettier formats none of the ${ledger.named} named file(s)`);
		}
		console.log('\n');
		if (mode === 'files') assertResolvedInputs(inputs);
		finish(ledger, scopeLabel);
		return;
	}

	if (!shouldRunLint) {
		for (const id of LINT_CHECKS) {
			ledger.skipped(id, `--scope ${scope}`, scopedMode && ledger.filesFor(id).length > 0);
		}
	}
	if (!shouldRunTypes) {
		for (const id of TYPE_CHECKS) {
			ledger.skipped(id, `--scope ${scope}`, scopedMode && ledger.filesFor(id).length > 0);
		}
	}

	// SvelteKit sync (always runs — needed by both lint and types)
	printHeader(step++, 'SvelteKit sync');
	await runCommand('bun', ['svelte-kit', 'sync']);
	if (countFullFormatter) {
		const nextTraversal = prettierTraversalPaths(REPO_ROOT, true);
		const nextFormattable = await prettierFormattableFiles(prettierProjectPaths(nextTraversal));
		const nextInventory = getGitInventory(REPO_ROOT);
		const traversalChanges = changedSnapshotPaths(fullFormatPaths, nextTraversal);
		const inventoryChanges = changedSnapshotPaths(
			inventorySnapshot(fullGitInventory),
			inventorySnapshot(nextInventory)
		).map((record) => record.split('\0', 1)[0]!);
		if (nextFormattable.join('\0') !== formattable.join('\0')) {
			fail('Formatter parser classification changed during SvelteKit sync.');
		}
		const changedPaths = [...new Set([...traversalChanges, ...inventoryChanges])];
		if (
			changedPaths.some((file) => !file.startsWith('.svelte-kit/')) ||
			(changedPaths.length > 0 && !usesIgnoredDefaultSvelteKitOutDir())
		) {
			fail(
				'Repository content outside the ignored default .svelte-kit output changed during sync.'
			);
		}
		assertResolvedInputs(inputs);
		fullFormatPaths = nextTraversal;
		formattable = nextFormattable;
	}
	ledger.ran('svelte-kit sync');
	console.log('\n');

	// -- Lint group: misspell, banned patterns, prettier, eslint, oxlint, knip --

	if (shouldRunLint) {
		// Spell checking
		printHeader(step++, 'Spell checking');
		if (hasMisspell()) {
			const records = ledger.recordsFor('misspell');
			const files = records.map((record) => record.path);

			if (files.length === 0) {
				console.log('No files to spell check');
			} else {
				const chunkSize = 100;
				for (let i = 0; i < files.length; i += chunkSize) {
					assertResolvedInputs(records.slice(i, i + chunkSize));
					await runCommand('misspell', ['-error', ...files.slice(i, i + chunkSize)]);
				}
			}
			ledger.ran('misspell', files.length);
		} else if (ciMode) {
			fail('ERROR: misspell is required in CI but not installed');
		} else {
			console.log(
				`${colors.yellow}WARNING: misspell not installed (skipping spell check)${colors.reset}`
			);
			console.log('Install with: go install github.com/client9/misspell/cmd/misspell@latest');
			ledger.skipped(
				'misspell',
				'not installed',
				scopedMode && ledger.filesFor('misspell').length > 0
			);
		}
		console.log('\n');

		// Banned patterns (deprecated tokens, bare animate-spin, static Sentry imports, execSync, ungated Tolgee apiKey)
		printHeader(step++, 'Banned patterns');
		{
			const records = ledger.recordsFor('banned-patterns');
			const filesToScan = records.map((record) => record.path);
			assertResolvedInputs(records);

			const violations: string[] = [];
			for (const file of filesToScan) {
				const content = Bun.file(file);
				const text = await content.text();
				const lines = text.split('\n');
				for (let i = 0; i < lines.length; i++) {
					const line = lines[i]!;
					if (CONFIG.bannedPatterns.deprecated.test(line)) {
						violations.push(`${file}:${i + 1}: deprecated token: ${line.trim()}`);
					}
					if (CONFIG.bannedPatterns.bareAnimateSpin.test(line)) {
						violations.push(
							`${file}:${i + 1}: bare animate-spin (use motion-safe:animate-spin): ${line.trim()}`
						);
					}
					if (CONFIG.bannedPatterns.staticSentryImport.test(line)) {
						violations.push(
							`${file}:${i + 1}: static @sentry/sveltekit import (lazy-load via $lib/monitoring/sentry; import type is allowed): ${line.trim()}`
						);
					}
					if (CONFIG.bannedPatterns.execSync.test(line)) {
						violations.push(
							`${file}:${i + 1}: execSync (use spawn-style argument arrays, see runCommandCapture in scripts/deploy/utils.ts): ${line.trim()}`
						);
					}
					if (CONFIG.bannedPatterns.ungatedTolgeeApiKey.test(line)) {
						violations.push(
							`${file}:${i + 1}: ungated Tolgee apiKey (gate behind import.meta.env.DEV so it is stripped from production/preview bundles): ${line.trim()}`
						);
					}
				}
			}

			if (violations.length > 0) {
				console.error(`${colors.red}Found ${violations.length} banned pattern(s):${colors.reset}`);
				for (const violation of violations) {
					console.error(`  ${sanitizeTerminalField(violation)}`);
				}
				process.exit(1);
			}
			console.log(`Scanned ${filesToScan.length} files — no banned patterns found`);
			ledger.ran('banned-patterns', filesToScan.length);
		}
		console.log('\n');

		// Literal control and bidirectional-formatting characters in authored text.
		// ESLint covers code; this reaches source formats it does not parse.
		printHeader(step++, 'Literal control characters');
		{
			const records = ledger.recordsFor('literal-control-char');
			const files = records.map((record) => record.path);
			assertResolvedInputs(records);
			const violations: string[] = [];
			for (const file of files) {
				violations.push(...literalControlCharacterViolations(file, await Bun.file(file).text()));
			}
			if (violations.length > 0) {
				for (const violation of violations)
					console.error(`${colors.red}${violation}${colors.reset}`);
				fail(`Found ${violations.length} literal control character violation(s).`);
			}
			console.log(
				`Scanned ${files.length} Markdown/text files — no literal control characters found`
			);
			ledger.ran('literal-control-char', files.length);
		}
		console.log('\n');

		// Code formatting
		printHeader(step++, 'Code formatting');
		{
			const formatFlag = assertMode ? '--check' : '--write';
			const files = ledger.filesFor('prettier');
			if (!scopedMode) {
				await runPrettier(formatFlag, undefined, ledger.records, {
					traversal: fullFormatPaths,
					formattable
				});
				ledger.ran('prettier', formattable.length);
			} else if (files.length > 0) {
				await runPrettier(formatFlag, files, ledger.recordsFor('prettier'));
				ledger.ran('prettier', files.length);
			} else {
				console.log('No files to format');
				ledger.ran('prettier', 0);
			}
		}
		console.log('\n');

		// ESLint
		printHeader(step++, 'ESLint');
		{
			const fixArgs = assertMode ? [] : ['--fix'];
			const records = ledger.recordsFor('eslint');
			const files = records.map((record) => record.path);
			if (files.length > 0) {
				let offset = 0;
				for (const batch of argumentBatches(files, ['eslint', ...fixArgs])) {
					assertResolvedInputs(records.slice(offset, offset + batch.length));
					offset += batch.length;
					await runCommand('bun', ['eslint', ...fixArgs, ...batch]);
				}
				ledger.ran('eslint', files.length);
			} else {
				console.log('No JS/TS/Svelte files to lint');
				ledger.ran('eslint', 0);
			}
		}
		console.log('\n');

		// oxlint
		printHeader(step++, 'oxlint');
		assertResolvedInputs(ledger.records);
		await runCommand('bun', ['oxlint']);
		ledger.ran('oxlint');
		console.log('\n');

		// knip: unused files, exports and dependencies. Whole-project like oxlint and, like
		// oxlint, never counted by the ledger toward work on the caller's files. It needs the
		// generated email module from `bun install`'s postinstall, which CI runs first.
		// The staged pre-commit gate skips it: knip reads the working tree, so an untracked
		// scratch file would block an unrelated commit, and the hook stays a fast staged
		// lint. The pre-push file run and CI's lint scope still fail on new dead code.
		if (mode !== 'staged') {
			printHeader(step++, 'knip');
			assertResolvedInputs(ledger.records);
			await runCommand('bun', ['knip', '--no-progress']);
			ledger.ran('knip');
			console.log('\n');
		}
	}

	// -- Types group: build-emails, svelte-check --

	if (shouldRunTypes) {
		// Build emails (required before type checking)
		printHeader(step++, 'Build emails');
		await runCommand('bun', ['scripts/build-emails.ts']);
		ledger.ran('build-emails');
		console.log('\n');

		// Type checking
		printHeader(step++, 'Type checking');
		{
			const records = ledger.recordsFor('svelte-check');
			if (records.length === 0) {
				console.log('No SvelteKit project files to check');
				ledger.ran('svelte-check', 0);
			} else {
				assertResolvedInputs(records);
				await runCommand('bun', ['svelte-check', '--tsconfig', './tsconfig.json'], {
					env: { ...process.env, NODE_OPTIONS: '--max-old-space-size=8192' }
				});
				ledger.ran('svelte-check', 'project');
			}
		}
		console.log('\n');

		// Agent skill type checking
		printHeader(step++, 'Agent skill type checking');
		{
			const records = ledger.recordsFor('skill-types');
			if (records.length > 0) {
				assertResolvedInputs(records);
				await runCommand('bun', ['run', 'check:skills']);
				ledger.ran('skill-types', 'project');
			} else {
				console.log('No agent skill TypeScript files to check');
				ledger.ran('skill-types', 0);
			}
		}
		console.log('\n');

		// Convex type checking
		printHeader(step++, 'Convex type checking');
		{
			const records = ledger.recordsFor('convex');
			if (records.length > 0) {
				assertResolvedInputs(records);
				await runCommand('bun', ['run', 'check:convex']);
				ledger.ran('convex', 'project');
			} else {
				console.log('No Convex files to check');
				ledger.ran('convex', 0);
			}
		}
		console.log('\n');

		// Autumn billing config validation (no auth needed, runs locally).
		// `atmn preview` only renders plans from the local autumn.config.ts; it never
		// diffs against or pushes to the live deployment. After any config edit,
		// `bunx atmn push` (sandbox) / `bunx atmn push -p` (prod) is a required manual
		// step that no automated check covers (the CLI's only diff is the hidden
		// debug-only `test-diff`, which requires auth, always exits 0, and prints
		// human-readable output, so there is no stable primitive to build a drift
		// guard from; auto-pushing from CI would be worse).
		printHeader(step, 'Autumn config');
		await runCommand('bun', ['atmn', 'preview']);
		ledger.ran('atmn preview');
		console.log('\n');
	}

	if (shouldRunLint) {
		printHeader(step, 'Knowledge placement');
		const policyScope =
			mode === 'staged'
				? ({ kind: 'staged' } as const)
				: mode === 'files'
					? ({ kind: 'files', files: ledger.filesFor('knowledge-placement') } as const)
					: ({ kind: 'full' } as const);
		assertResolvedInputs(ledger.recordsFor('knowledge-placement'));
		const result = runKnowledgePolicy({
			root: REPO_ROOT,
			policy: knowledgePolicy,
			scope: policyScope
		});
		for (const policyFinding of result.findings) {
			const line = sanitizeTerminalField(formatPolicyFinding(policyFinding));
			console[policyFinding.severity === 'error' ? 'error' : 'warn'](`  ${line}`);
		}
		const errors = result.findings.filter((item) => item.severity === 'error').length;
		const warnings = result.findings.length - errors;
		const scopeNote = result.escalatedFromFiles ? ' (files scope escalated to full)' : '';
		console.log(
			`Scanned ${result.filesEvaluated} knowledge-bearing files${scopeNote}: ` +
				`${errors} error(s), ${warnings} warning(s)`
		);
		// Staged policy evaluation reads every knowledge candidate in the index so links resolve
		// against the final committed tree. That project-wide count cannot earn green for an
		// unrelated named input: a staged binary matched no lint route, while 1,164 Markdown
		// files made `consumedAnything()` return true. In scoped modes only the named knowledge
		// candidates count as consumed work; the broader scan remains visible in the log.
		ledger.ran(
			'knowledge-placement',
			scopedMode ? ledger.filesFor('knowledge-placement').length : result.filesEvaluated
		);
		if (errors > 0) process.exit(1);
		console.log('');
	}

	if (stagedIndexFingerprint) {
		assertResolvedInputs(inputs);
		if (!stagedFilesMatchWorktree(stagedValidatedPaths, REPO_ROOT, stagedEnv)) {
			fail('Checked worktree bytes changed while staged checks were running.');
		}
		if (activeGitIndexFingerprint(REPO_ROOT, stagedEnv) !== stagedIndexFingerprint) {
			fail('The active Git index changed while staged checks were running.');
		}
	} else if (mode === 'files') {
		assertResolvedInputs(inputs);
	}

	finish(ledger, scopeLabel);
}

// Guarded so static-checks.test.ts can import resolveInputs and ROUTES without
// running the gate or changing the importing process's exit code.
if (import.meta.main) {
	// Default-deny: finish() is the only path that writes a zero exit code.
	process.exitCode = 2;
	main().catch((error: Error) => {
		console.error(
			`${colors.red}Fatal error: ${sanitizeTerminalField(error.message)}${colors.reset}`
		);
		process.exit(1);
	});
}
