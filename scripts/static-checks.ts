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
 *
 * Flags:
 *   --ci      Assert mode: uses --check for formatting, omits --fix for ESLint.
 *             Requires misspell to be installed (fails if missing).
 *   --staged  Scope to git-staged files only. Auto-fixes and re-stages.
 *   --scope   Run a subset of checks: "lint" (misspell, banned patterns, prettier,
 *             eslint, oxlint) or "types" (build-emails, svelte-check).
 *             Both groups run svelte-kit sync first. Omit to run all checks.
 */

import { spawnSync, type SpawnSyncOptions } from 'child_process';
import { parseArgs } from 'util';

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
		bareAnimateSpin: /(?<!motion-safe:)animate-spin/
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

// Parse command line arguments
const { values, positionals } = parseArgs({
	args: Bun.argv,
	options: {
		staged: { type: 'boolean', default: false },
		ci: { type: 'boolean', default: false },
		scope: { type: 'string' }
	},
	strict: false,
	allowPositionals: true
});

const stagedOnly = values.staged ?? false;
const ciMode = values.ci ?? false;
const scope = values.scope as 'lint' | 'types' | undefined;

if (scope && !['lint', 'types'].includes(scope)) {
	console.error(
		`${colors.red}Invalid --scope value: "${scope}". Use "lint" or "types".${colors.reset}`
	);
	process.exit(1);
}

const shouldRunLint = !scope || scope === 'lint';
const shouldRunTypes = !scope || scope === 'types';
// Skip first two positionals (bun runtime + script path)
const positionalFiles = positionals.slice(2);

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
 * Get list of staged files from git
 */
function getStagedFiles(): string[] {
	const result = spawnSync('git', ['diff', '--cached', '--name-only', '--diff-filter=ACMR'], {
		encoding: 'utf-8'
	});

	if (result.status !== 0) {
		console.error('Failed to get staged files');
		process.exit(1);
	}

	return result.stdout.trim().split('\n').filter(Boolean);
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

/**
 * Derive file subsets from a list of paths
 */
function deriveFileSets(files: string[]) {
	const relevantFiles = files.filter(
		(f) => !CONFIG.ignorePaths.some((ignore) => f.includes(ignore))
	);

	return {
		jsTsSvelteFiles: relevantFiles.filter((f) => /\.(js|ts|svelte)$/.test(f)),
		formattableFiles: relevantFiles.filter((f) => /\.(js|ts|svelte|html|css|md|json)$/.test(f)),
		svelteFiles: relevantFiles.filter((f) => f.endsWith('.svelte'))
	};
}

// Resolve mode: positional files > --staged > full project
type Mode = 'files' | 'staged' | 'full';
const mode: Mode = positionalFiles.length > 0 ? 'files' : stagedOnly ? 'staged' : 'full';
const scopedMode = mode === 'files' || mode === 'staged';

// Main execution
async function main(): Promise<void> {
	let allFiles: string[] = [];
	let jsTsSvelteFiles: string[] = [];
	let formattableFiles: string[] = [];
	let svelteFiles: string[] = [];

	if (mode === 'files') {
		allFiles = positionalFiles;

		console.log('======================================================');
		console.log(`Static Checks (${allFiles.length} specified files)`);
		console.log('======================================================\n');

		({ jsTsSvelteFiles, formattableFiles, svelteFiles } = deriveFileSets(allFiles));
	} else if (mode === 'staged') {
		allFiles = getStagedFiles();

		if (allFiles.length === 0) {
			console.log('No staged files to check');
			process.exit(0);
		}

		console.log('======================================================');
		console.log(`Static Checks (${allFiles.length} staged files)`);
		console.log('======================================================\n');

		({ jsTsSvelteFiles, formattableFiles, svelteFiles } = deriveFileSets(allFiles));
	} else {
		const scopeLabel = scope ? ` — ${scope} only` : '';
		console.log('======================================================');
		console.log(`Static Checks (full project${scopeLabel})`);
		console.log('======================================================\n');
	}

	let step = 1;

	// SvelteKit sync (always runs — needed by both lint and types)
	printHeader(step++, 'SvelteKit sync');
	runCommand('bun', ['svelte-kit', 'sync']);
	console.log('\n');

	// -- Lint group: misspell, banned patterns, prettier, eslint, oxlint --

	if (shouldRunLint) {
		// Spell checking
		printHeader(step++, 'Spell checking');
		if (hasMisspell()) {
			if (scopedMode) {
				// Check scoped files (exclude paths matching CI exclusions)
				const checkableFiles = allFiles.filter(
					(f) => !CONFIG.misspell.ignore.some((ignore) => f.includes(ignore))
				);

				if (checkableFiles.length > 0) {
					// Batch files to avoid command line length limits
					const chunkSize = 100;
					for (let i = 0; i < checkableFiles.length; i += chunkSize) {
						const chunk = checkableFiles.slice(i, i + chunkSize);
						runCommand('misspell', ['-error', ...chunk]);
					}
				} else {
					console.log('No files to spell check');
				}
			} else {
				// Check all files (matches CI find command exclusions)
				const glob = new Bun.Glob('**/*');
				const files = [...glob.scanSync({ absolute: false })].filter(
					(f) => !CONFIG.misspell.ignore.some((ignore) => f.includes(ignore))
				);

				// Batch files to avoid command line length limits
				const chunkSize = 100;
				for (let i = 0; i < files.length; i += chunkSize) {
					const chunk = files.slice(i, i + chunkSize);
					runCommand('misspell', ['-error', ...chunk]);
				}
			}
		} else if (ciMode) {
			console.error(
				`${colors.red}ERROR: misspell is required in CI but not installed${colors.reset}`
			);
			process.exit(1);
		} else {
			console.log(
				`${colors.yellow}WARNING: misspell not installed (skipping spell check)${colors.reset}`
			);
			console.log('Install with: go install github.com/client9/misspell/cmd/misspell@latest');
		}
		console.log('\n');

		// Banned patterns (deprecated tokens, bare animate-spin)
		printHeader(step++, 'Banned patterns');
		{
			const filesToScan = scopedMode
				? allFiles.filter((f) => /\.(svelte|ts)$/.test(f) && f.startsWith('src/'))
				: (() => {
						const glob = new Bun.Glob('src/**/*.{svelte,ts}');
						return [...glob.scanSync({ absolute: false })];
					})();

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
				}
			}

			if (violations.length > 0) {
				console.error(`${colors.red}Found ${violations.length} banned pattern(s):${colors.reset}`);
				for (const v of violations) console.error(`  ${v}`);
				process.exit(1);
			}
			console.log(`Scanned ${filesToScan.length} files — no banned patterns found`);
		}
		console.log('\n');

		// Code formatting
		printHeader(step++, 'Code formatting');
		{
			const formatFlag = ciMode ? '--check' : '--write';
			if (scopedMode && formattableFiles.length > 0) {
				runCommand('bun', [
					'prettier',
					formatFlag,
					'--plugin',
					'prettier-plugin-svelte',
					...formattableFiles
				]);
			} else if (!scopedMode) {
				runCommand('bun', ['prettier', formatFlag, '.']);
			} else {
				console.log('No files to format');
			}
		}
		console.log('\n');

		// ESLint
		printHeader(step++, 'ESLint');
		{
			const fixArgs = ciMode ? [] : ['--fix'];
			if (scopedMode && jsTsSvelteFiles.length > 0) {
				runCommand('bun', ['eslint', ...fixArgs, ...jsTsSvelteFiles]);
			} else if (!scopedMode) {
				runCommand('bun', ['eslint', '.', ...fixArgs]);
			} else {
				console.log('No JS/TS/Svelte files to lint');
			}
		}
		console.log('\n');

		// oxlint
		printHeader(step++, 'oxlint');
		runCommand('bun', ['oxlint']);
		console.log('\n');
	}

	// -- Types group: build-emails, svelte-check --

	if (shouldRunTypes) {
		// Build emails (required before type checking)
		printHeader(step++, 'Build emails');
		runCommand('bun', ['scripts/build-emails.ts']);
		console.log('\n');

		// Type checking
		printHeader(step++, 'Type checking');
		if (scopedMode && jsTsSvelteFiles.length === 0 && svelteFiles.length === 0) {
			console.log('No TypeScript/Svelte files to check');
		} else {
			runCommand('bun', ['svelte-check', '--tsconfig', './tsconfig.json'], {
				env: { ...process.env, NODE_OPTIONS: '--max-old-space-size=8192' }
			});
		}
		console.log('\n');
	}

	// Re-stage files if they were modified during --staged checks
	if (mode === 'staged' && !ciMode) {
		console.log('Re-staging modified files...');
		runCommand('git', ['add', ...allFiles]);
		console.log('');
	}

	console.log('======================================================');
	console.log(`${colors.green}All checks passed!${colors.reset}`);
	console.log('======================================================');
}

main().catch((error: Error) => {
	console.error(`${colors.red}Fatal error: ${error.message}${colors.reset}`);
	process.exit(1);
});
