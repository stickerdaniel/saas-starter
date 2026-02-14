/**
 * Unified static checks script (cross-platform TypeScript version)
 *
 * Usage:
 *   bun scripts/static-checks.ts                      - Check all files (CI)
 *   bun scripts/static-checks.ts --staged              - Check only staged files (pre-commit)
 *   bun scripts/static-checks.ts file1.ts file2.svelte - Check specific files
 */

import { spawnSync, type SpawnSyncOptions } from 'child_process';
import { parseArgs } from 'util';

// Configuration (matches CI static-checks.yml exclusions)
const CONFIG = {
	misspell: {
		ignore: ['src/i18n/', 'convex/_generated/', 'node_modules/', '.git/', '.svelte-kit/']
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
		staged: { type: 'boolean', default: false }
	},
	strict: false,
	allowPositionals: true
});

const stagedOnly = values.staged ?? false;
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
 * Check if misspell is installed
 */
function hasMisspell(): boolean {
	const result = spawnSync('which', ['misspell'], { encoding: 'utf-8' });
	return result.status === 0;
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
	return {
		jsTsSvelteFiles: files.filter((f) => /\.(js|ts|svelte)$/.test(f)),
		formattableFiles: files.filter((f) => /\.(js|ts|svelte|html|css|md|json)$/.test(f)),
		svelteFiles: files.filter((f) => /\.svelte$/.test(f))
	};
}

// Resolve mode: positional files > --staged > full project
type Mode = 'files' | 'staged' | 'full';
const mode: Mode = positionalFiles.length > 0 ? 'files' : stagedOnly ? 'staged' : 'full';
const scopedMode = mode === 'files' || mode === 'staged';

// Main execution
function main(): void {
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
		console.log('======================================================');
		console.log('Static Checks (full project)');
		console.log('======================================================\n');
	}

	// 1. SvelteKit sync
	printHeader(1, 'SvelteKit sync');
	runCommand('bun', ['svelte-kit', 'sync']);
	console.log('\n');

	// 2. Spell checking
	printHeader(2, 'Spell checking');
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
	} else {
		console.log(
			`${colors.yellow}WARNING: misspell not installed (skipping spell check)${colors.reset}`
		);
		console.log('Install with: go install github.com/client9/misspell/cmd/misspell@latest');
	}
	console.log('\n');

	// 3. Code formatting
	printHeader(3, 'Code formatting');
	if (scopedMode && formattableFiles.length > 0) {
		runCommand('bun', [
			'prettier',
			'--write',
			'--plugin',
			'prettier-plugin-svelte',
			...formattableFiles
		]);
	} else if (!scopedMode) {
		runCommand('bun', ['run', 'format']);
	} else {
		console.log('No files to format');
	}
	console.log('\n');

	// 4. ESLint
	printHeader(4, 'ESLint');
	if (scopedMode && jsTsSvelteFiles.length > 0) {
		runCommand('bun', ['eslint', '--fix', ...jsTsSvelteFiles]);
	} else if (!scopedMode) {
		runCommand('bun', ['eslint', '.', '--fix']);
	} else {
		console.log('No JS/TS/Svelte files to lint');
	}
	console.log('\n');

	// 5. Build emails (required before type checking)
	printHeader(5, 'Build emails');
	runCommand('bun', ['scripts/build-emails.ts']);
	console.log('\n');

	// 6. Type checking
	printHeader(6, 'Type checking');
	if (scopedMode && jsTsSvelteFiles.length === 0 && svelteFiles.length === 0) {
		console.log('No TypeScript/Svelte files to check');
	} else {
		runCommand('bun', ['svelte-check', '--tsconfig', './tsconfig.json'], {
			env: { ...process.env, NODE_OPTIONS: '--max-old-space-size=8192' }
		});
	}
	console.log('\n');

	// Re-stage files if they were modified during --staged checks
	if (mode === 'staged') {
		console.log('Re-staging modified files...');
		runCommand('git', ['add', ...allFiles]);
		console.log('');
	}

	console.log('======================================================');
	console.log(`${colors.green}All checks passed!${colors.reset}`);
	console.log('======================================================');
}

main();
