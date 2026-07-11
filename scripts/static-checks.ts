/**
 * Unified static checks script (cross-platform TypeScript version)
 *
 * Usage:
 *   bun scripts/static-checks.ts                      - Check all files, auto-fix (local dev)
 *   bun scripts/static-checks.ts --ci                  - Check all files, assert-only (CI)
 *   bun scripts/static-checks.ts --ci --scope lint     - Linting checks only (CI job group)
 *   bun scripts/static-checks.ts --ci --scope types    - Type checking only (CI job group)
 *   bun scripts/static-checks.ts --staged              - Check only staged files (pre-commit)
 *   bun scripts/static-checks.ts file1.ts file2.svelte - Check specific files
 *   ... | bun scripts/static-checks.ts --files-from -  - Check a computed list of files
 *
 * Flags:
 *   --ci         Assert mode: uses --check for formatting, omits --fix for ESLint.
 *                Requires misspell to be installed (fails if missing).
 *   --staged     Scope to git-staged files only. Auto-fixes and re-stages.
 *   --scope      Run a subset of checks: "lint" (misspell, banned patterns, prettier,
 *                eslint, oxlint) or "types" (build-emails, svelte-check).
 *                Both groups run svelte-kit sync first. Omit to run all checks.
 *   --files-from Read newline-separated paths from a file, or from stdin with "-".
 *                Use this for a COMPUTED list: unlike positionals, this channel can
 *                carry an empty list, which is an honest no-op instead of a silent
 *                zero-file run.
 *
 * Paths are validated and normalized at intake (see resolveInputs). An empty
 * argument, a newline-joined blob, a missing path, or a path outside the repo is a
 * hard error, never a run that checks nothing and reports success.
 */

import { spawnSync, type SpawnSyncOptions } from 'child_process';
import { existsSync, readFileSync, realpathSync, statSync } from 'fs';
import path from 'path';
import { parseArgs } from 'util';
import { getStagedFiles, isUnderPreCommit, sanitizedGitEnv } from './git-context';

// Configuration (matches CI static-checks.yml exclusions)
const CONFIG = {
	ignorePaths: ['references/'],
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

// ANSI colors for terminal output
const colors = {
	reset: '\x1b[0m',
	bold: '\x1b[1m',
	green: '\x1b[32m',
	yellow: '\x1b[33m',
	red: '\x1b[31m'
};

// ===========================================================================
// Intake — argv and file arguments become validated, repo-relative POSIX paths
// ===========================================================================

/** Repo root, from this script's own location. Correct under worktrees and nesting. */
const REPO_ROOT = realpathSync(path.resolve(import.meta.dir, '..'));

const USAGE = '  Flags: --ci, --staged, --scope <lint|types>, --files-from <path|->';

/** Directories never descended into when a directory argument is expanded. */
const NEVER_WALK = ['node_modules/', '.git/', '.svelte-kit/', '.convex/', 'build/', 'dist/'];

/**
 * Reject the run. A gate that cannot see its input must never report success.
 */
function fail(message: string, hint?: string): never {
	console.error(`${colors.red}${message}${colors.reset}`);
	if (hint) console.error(hint);
	process.exit(1);
}

function toPosix(p: string): string {
	return p.split(path.sep).join('/');
}

/**
 * The single door every caller-supplied path comes through.
 *
 * Two failures used to hide behind this boundary, and both ended the same way: a run
 * that checked nothing and printed "All checks passed!".
 *
 *   1. Nothing VALIDATED a positional. `static-checks.ts ""` — a caller expanding an
 *      empty shell variable into a quoted argument — counted as one "specified file",
 *      matched no extension filter, skipped every check, and exited 0 (#691). A
 *      directory, a missing path, and a newline-joined blob all did the same.
 *
 *   2. Nothing NORMALIZED a positional. The banned-pattern scan and the Convex gate
 *      are `startsWith('src/')` prefix tests, so an ABSOLUTE path matched neither and
 *      those checks silently no-opped — while prettier, eslint and svelte-check
 *      accepted the very same path and made the run look substantive. AGENTS.md tells
 *      every agent to pass absolute paths, so this was the common case, not the exotic
 *      one.
 *
 * Normalizing here fixes (2) for every prefix gate at once, including the ones a fork
 * adds later, without touching a single gate.
 */
function resolveInputs(raw: string[], origin: string): string[] {
	const out = new Set<string>();

	for (const arg of raw) {
		if (arg.trim() === '') {
			fail(
				`Empty path in ${origin}.`,
				'  An empty string is not a file. This is usually a caller expanding an empty\n' +
					'  variable into a quoted argument (`static-checks.ts "$FILES"`). Pass no\n' +
					'  arguments to check the whole project, or use `--files-from -` for a list\n' +
					'  that may legitimately be empty.'
			);
		}
		if (/[\r\n]/.test(arg)) {
			fail(
				`Newline inside a single path argument (${origin}): ${JSON.stringify(arg.slice(0, 40))}`,
				'  A newline-separated list arrived as ONE argument. Leave the expansion\n' +
					'  unquoted, or pipe it: `git diff --name-only | ... --files-from -`.'
			);
		}

		// Resolve against the invocation cwd (what the caller typed is relative to),
		// then re-express against the repo root (what every gate below assumes).
		// realpath both sides so a checkout reached through a symlink (/tmp ->
		// /private/tmp, a symlinked worktree) does not read as "outside the repo".
		const absolute = path.resolve(arg);
		if (!existsSync(absolute)) fail(`No such file (${origin}): ${arg}`);

		const real = realpathSync(absolute);
		const relative = toPosix(path.relative(REPO_ROOT, real));
		if (relative === '' || relative.startsWith('..')) {
			fail(`Path is outside the repository (${origin}): ${arg}`, `  Repo root: ${REPO_ROOT}`);
		}

		if (statSync(real).isDirectory()) {
			const before = out.size;
			for (const entry of new Bun.Glob(`${relative}/**/*`).scanSync({ cwd: REPO_ROOT })) {
				const file = toPosix(entry);
				if (NEVER_WALK.some((skip) => file.includes(skip))) continue;
				out.add(file);
			}
			if (out.size === before) fail(`Directory contains no files to check (${origin}): ${arg}`);
			continue;
		}

		out.add(relative);
	}

	return [...out].sort();
}

/** Newline-separated paths from a file, or from stdin with "-". An empty list is legal. */
function readFilesFrom(source: string): string[] {
	const raw =
		source === '-'
			? readFileSync(0, 'utf-8')
			: existsSync(path.resolve(source))
				? readFileSync(path.resolve(source), 'utf-8')
				: fail(`--files-from: no such file: ${source}`);

	return raw
		.split('\n')
		.map((line) => line.trim())
		.filter((line) => line !== '');
}

// ===========================================================================
// Ledger — one routing table, one accounting of what actually ran
// ===========================================================================

/**
 * Which checks are responsible for a repo-relative path. The ONLY place a file set is
 * derived, so a check can no longer disagree with the ledger about its own scope, and
 * a new check has to declare a route to be accounted for.
 */
const ROUTES = {
	misspell: (f: string) => !CONFIG.misspell.ignore.some((i) => f.includes(i)),
	'banned-patterns': (f: string) => /\.(svelte|ts)$/.test(f) && f.startsWith('src/'),
	prettier: (f: string) => /\.(js|ts|svelte|html|css|md|json)$/.test(f),
	eslint: (f: string) => /\.(js|ts|svelte)$/.test(f),
	// The old gate was `jsTsSvelteFiles.length === 0 && svelteFiles.length === 0`;
	// svelteFiles is a subset of jsTsSvelteFiles, so the second clause was dead.
	'svelte-check': (f: string) => /\.(js|ts|svelte)$/.test(f),
	convex: (f: string) => f.startsWith('src/lib/convex/')
} as const;

type CheckId = keyof typeof ROUTES;
const CHECK_IDS = Object.keys(ROUTES) as CheckId[];
const LINT_CHECKS: CheckId[] = ['misspell', 'banned-patterns', 'prettier', 'eslint'];
const TYPE_CHECKS: CheckId[] = ['svelte-check', 'convex'];

type Mode = 'files' | 'staged' | 'full';
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
	readonly files: string[];
	readonly ignored: string[];
	private readonly outcomes = new Map<string, Outcome>();

	constructor(
		readonly mode: Mode,
		inputs: string[]
	) {
		this.named = inputs.length;
		this.ignored = inputs.filter((f) => CONFIG.ignorePaths.some((i) => f.includes(i)));
		this.files = inputs.filter((f) => !this.ignored.includes(f));
	}

	filesFor(id: CheckId): string[] {
		return this.files.filter(ROUTES[id]);
	}

	ran(id: string, files: number | 'project' = 'project'): void {
		this.outcomes.set(id, { kind: 'ran', files });
	}

	skipped(id: string, reason: string, suppressed = false): void {
		this.outcomes.set(id, { kind: 'skipped', reason, suppressed });
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

		// Zero work on the named files. Two reasons are honest; anything else is the bug.
		const honest: string[] = [];
		if (this.named > 0 && this.ignored.length === this.named) {
			honest.push(`all ${this.named} input(s) are excluded by CONFIG.ignorePaths`);
		}
		if (this.suppressedWork()) {
			honest.push(`every check covering them is switched off (scope: ${scopeLabel})`);
		}

		if (honest.length === 0) {
			fail(
				`${this.named} file(s) named, and no check ran over any of them.`,
				'  No check in ROUTES is responsible for them, so nothing was verified.\n' +
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
	const scope = values.scope as 'lint' | 'types' | undefined;
	const filesFrom = values['files-from'];

	if (scope && !['lint', 'types'].includes(scope)) {
		fail(`Invalid --scope value: "${scope}". Use "lint" or "types".`);
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

	return { ciMode, scope, mode, rawPositionals, filesFrom };
}

/**
 * Run a command and exit if it fails
 */
function runCommand(command: string, args: string[], options?: SpawnSyncOptions): void {
	const result = spawnSync(command, args, {
		stdio: 'inherit',
		encoding: 'utf-8',
		...options
	});

	if (result.status !== 0) {
		console.error(`${colors.red}Command failed: ${command} ${args.join(' ')}${colors.reset}`);
		process.exit(result.status ?? 1);
	}
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

// Main execution
async function main(): Promise<void> {
	const { ciMode, scope, mode, rawPositionals, filesFrom } = parseCli();

	const shouldRunLint = !scope || scope === 'lint';
	const shouldRunTypes = !scope || scope === 'types';
	const scopedMode = mode === 'files' || mode === 'staged';
	const scopeLabel = scope ?? 'lint + types';

	// Resolve caller-typed paths against the invocation cwd, BEFORE the chdir below.
	let inputs: string[] = [];
	// Staged mode only: the paths exactly as git reported them, for the re-stage.
	let stagedIndexPaths: string[] = [];
	if (mode === 'files') {
		const raw = filesFrom !== undefined ? readFilesFrom(filesFrom) : rawPositionals;
		if (filesFrom !== undefined && raw.length === 0) {
			// The one channel that can carry an empty list. Positionals cannot say this
			// (`f()` and `f("")` are the same empty set), which is why the `"$FILES"`
			// idiom used to fake a green run.
			console.log('No files to check (empty --files-from list)');
			process.exit(0);
		}
		inputs = resolveInputs(
			raw,
			filesFrom !== undefined ? `--files-from ${filesFrom}` : 'arguments'
		);
	}

	// Every glob and every subprocess below assumes the repo root (`bun prettier .`,
	// `Bun.Glob('src/**/*')`, the `src/` prefix gates). Make that a fact rather than an
	// unstated precondition — after resolving caller paths, so a relative argument still
	// means what the caller meant.
	process.chdir(REPO_ROOT);

	if (mode === 'staged') {
		// Safe to demand existence: getStagedFiles() passes --diff-filter=ACMR, so a
		// deleted path never reaches here. A fork that drops that filter fails loudly.
		// The index paths are kept verbatim for the re-stage below: resolveInputs
		// realpaths, and re-staging a resolved symlink would `git add` its target,
		// silently committing edits the developer never staged. This repo tracks
		// CLAUDE.md -> AGENTS.md and the .claude/skills links, so it is not theoretical.
		stagedIndexPaths = getStagedFiles();
		inputs = resolveInputs(stagedIndexPaths, 'the git index');
		if (inputs.length === 0) {
			console.log('No staged files to check');
			process.exit(0);
		}
	}

	const ledger = new Ledger(mode, inputs);

	console.log('======================================================');
	console.log(
		mode === 'full'
			? `Static Checks (full project — ${scopeLabel})`
			: `Static Checks (${ledger.named} ${mode === 'staged' ? 'staged' : 'specified'} files — ${scopeLabel})`
	);
	console.log('======================================================\n');

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

	let step = 1;

	// SvelteKit sync (always runs — needed by both lint and types)
	printHeader(step++, 'SvelteKit sync');
	runCommand('bun', ['svelte-kit', 'sync']);
	ledger.ran('svelte-kit sync');
	console.log('\n');

	// -- Lint group: misspell, banned patterns, prettier, eslint, oxlint --

	if (shouldRunLint) {
		// Spell checking
		printHeader(step++, 'Spell checking');
		if (hasMisspell()) {
			const files = scopedMode
				? ledger.filesFor('misspell')
				: [...new Bun.Glob('**/*').scanSync({ absolute: false })]
						.map(toPosix)
						.filter((f) => ROUTES.misspell(f));

			if (files.length === 0) {
				console.log('No files to spell check');
			} else {
				// Batch files to avoid command line length limits
				const chunkSize = 100;
				for (let i = 0; i < files.length; i += chunkSize) {
					runCommand('misspell', ['-error', ...files.slice(i, i + chunkSize)]);
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
			const filesToScan = scopedMode
				? ledger.filesFor('banned-patterns')
				: [...new Bun.Glob('src/**/*.{svelte,ts}').scanSync({ absolute: false })].map(toPosix);

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
				for (const v of violations) console.error(`  ${v}`);
				process.exit(1);
			}
			console.log(`Scanned ${filesToScan.length} files — no banned patterns found`);
			ledger.ran('banned-patterns', filesToScan.length);
		}
		console.log('\n');

		// Code formatting
		printHeader(step++, 'Code formatting');
		{
			const formatFlag = ciMode ? '--check' : '--write';
			const files = ledger.filesFor('prettier');
			if (!scopedMode) {
				runCommand('bun', ['prettier', formatFlag, '.']);
				ledger.ran('prettier');
			} else if (files.length > 0) {
				runCommand('bun', [
					'prettier',
					formatFlag,
					'--plugin',
					'prettier-plugin-svelte',
					'--plugin',
					'prettier-plugin-tailwindcss',
					...files
				]);
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
			const fixArgs = ciMode ? [] : ['--fix'];
			const files = ledger.filesFor('eslint');
			if (!scopedMode) {
				runCommand('bun', ['eslint', '.', ...fixArgs]);
				ledger.ran('eslint');
			} else if (files.length > 0) {
				runCommand('bun', ['eslint', ...fixArgs, ...files]);
				ledger.ran('eslint', files.length);
			} else {
				console.log('No JS/TS/Svelte files to lint');
				ledger.ran('eslint', 0);
			}
		}
		console.log('\n');

		// oxlint
		printHeader(step++, 'oxlint');
		runCommand('bun', ['oxlint']);
		ledger.ran('oxlint');
		console.log('\n');
	}

	// -- Types group: build-emails, svelte-check --

	if (shouldRunTypes) {
		// Build emails (required before type checking)
		printHeader(step++, 'Build emails');
		runCommand('bun', ['scripts/build-emails.ts']);
		ledger.ran('build-emails');
		console.log('\n');

		// Type checking
		printHeader(step++, 'Type checking');
		{
			const files = ledger.filesFor('svelte-check');
			if (scopedMode && files.length === 0) {
				console.log('No TypeScript/Svelte files to check');
				ledger.ran('svelte-check', 0);
			} else {
				runCommand('bun', ['svelte-check', '--tsconfig', './tsconfig.json'], {
					env: { ...process.env, NODE_OPTIONS: '--max-old-space-size=8192' }
				});
				// svelte-check is tsconfig-driven: the routed files decide WHETHER it runs,
				// then it type-checks the whole project regardless.
				ledger.ran('svelte-check', 'project');
			}
		}
		console.log('\n');

		// Convex type checking
		printHeader(step++, 'Convex type checking');
		{
			const files = ledger.filesFor('convex');
			if (!scopedMode || files.length > 0) {
				runCommand('bun', ['run', 'check:convex']);
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
		runCommand('bun', ['atmn', 'preview']);
		ledger.ran('atmn preview');
		console.log('\n');
	}

	// Re-stage files if they were modified during --staged checks.
	// Sanitized env ensures `git add` writes into the correct index even when
	// a parent process (e.g. the pre-commit framework) set GIT_DIR/GIT_WORK_TREE.
	if (mode === 'staged' && !ciMode) {
		console.log('Re-staging modified files...');
		if (isUnderPreCommit()) {
			console.log(
				'  (note: pre-commit framework detected. It will report "files were modified ' +
					'by this hook" and abort the commit. Run `git commit` again with no further ' +
					'changes to land the auto-fixes.)'
			);
		}
		runCommand('git', ['add', ...stagedIndexPaths], { env: sanitizedGitEnv() });
		console.log('');
	}

	finish(ledger, scopeLabel);
}

// Default-deny: exit 0 is written in exactly one place (finish), after the ledger has
// been asserted. A fall-through, an early return, or a refactor that drops the call
// now exits non-zero instead of inheriting a green.
process.exitCode = 2;

main().catch((error: Error) => {
	console.error(`${colors.red}Fatal error: ${error.message}${colors.reset}`);
	process.exit(1);
});
