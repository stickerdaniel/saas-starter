/**
 * Worktree management with Graphite integration (cross-platform TypeScript version)
 *
 * Usage:
 *   bun scripts/create-worktree.ts feature/dark-mode           # Full mode: create + setup
 *   bun scripts/create-worktree.ts --setup-only               # Setup mode: setup only (for Cursor)
 *   bun scripts/create-worktree.ts feature/dark-mode --open-editor cursor
 */

import { spawnSync } from 'child_process';
import { chmodSync, existsSync, copyFileSync, mkdirSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { parseArgs } from 'util';

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
	args: Bun.argv.slice(2),
	options: {
		'setup-only': { type: 'boolean', default: false },
		'open-editor': { type: 'string' },
		base: { type: 'string', short: 'b' },
		help: { type: 'boolean', short: 'h', default: false }
	},
	strict: false,
	allowPositionals: true
});

const setupOnly = values['setup-only'] ?? false;
const openEditor = values['open-editor'];
const branchName = positionals[0];

/**
 * Check if a command exists on the system (uses Bun.which for cross-platform support)
 */
function commandExists(command: string): boolean {
	return Bun.which(command) !== null;
}

/**
 * Run a command and return the result
 */
function runCommand(
	command: string,
	args: string[],
	options?: { silent?: boolean; cwd?: string }
): { success: boolean; stdout: string; stderr: string } {
	const result = spawnSync(command, args, {
		encoding: 'utf-8',
		cwd: options?.cwd
	});

	if (!options?.silent && result.status !== 0) {
		console.error(`${colors.red}Command failed: ${command} ${args.join(' ')}${colors.reset}`);
		if (result.stderr) console.error(result.stderr);
	}

	return {
		success: result.status === 0,
		stdout: result.stdout?.trim() ?? '',
		stderr: result.stderr?.trim() ?? ''
	};
}

/**
 * Run a command with inherited stdio (shows output in real-time)
 */
function runCommandInherit(command: string, args: string[], cwd?: string): boolean {
	const result = spawnSync(command, args, {
		stdio: 'inherit',
		encoding: 'utf-8',
		cwd
	});
	return result.status === 0;
}

/**
 * Get main repo path (where .git directory is).
 * Uses `git worktree list --porcelain` so this returns the main repo root
 * even when invoked from inside an auxiliary worktree.
 */
function getRootWorktree(): string {
	const result = runCommand('git', ['worktree', 'list', '--porcelain'], { silent: true });
	if (!result.success || !result.stdout) {
		console.error(`${colors.red}Error: Not in a git repository${colors.reset}`);
		process.exit(1);
	}
	// First line of --porcelain output is always "worktree <path>" for the
	// main worktree, regardless of which worktree the script is invoked from.
	// Trim to strip trailing \r on Windows (CRLF line endings).
	const firstLine = result.stdout.split('\n')[0].trim();
	const mainRepoPath = firstLine.replace(/^worktree /, '');
	if (!mainRepoPath) {
		console.error(`${colors.red}Error: Could not determine main repo path${colors.reset}`);
		process.exit(1);
	}
	return mainRepoPath;
}

/**
 * Setup worktree (copies files, installs deps, tracks with Graphite)
 */
function setupWorktree(rootPath: string): void {
	console.log('');
	console.log('======================================================');
	console.log('Setting up worktree');
	console.log('======================================================');
	console.log('');

	// Copy .env.local if it exists
	const envLocalSrc = join(rootPath, '.env.local');
	if (existsSync(envLocalSrc)) {
		console.log('Copying .env.local...');
		copyFileSync(envLocalSrc, '.env.local');
		console.log(`${colors.green}.env.local copied${colors.reset}`);
	} else {
		console.log(`${colors.yellow}No .env.local found in root worktree (skipping)${colors.reset}`);
	}
	console.log('');

	// Copy .env.convex.local if it exists
	const envConvexLocalSrc = join(rootPath, '.env.convex.local');
	if (existsSync(envConvexLocalSrc)) {
		console.log('Copying .env.convex.local...');
		copyFileSync(envConvexLocalSrc, '.env.convex.local');
		console.log(`${colors.green}.env.convex.local copied${colors.reset}`);
	} else {
		console.log(
			`${colors.yellow}No .env.convex.local found in root worktree (skipping)${colors.reset}`
		);
	}
	console.log('');

	// Copy .env.test if it exists
	const envTestSrc = join(rootPath, '.env.test');
	if (existsSync(envTestSrc)) {
		console.log('Copying .env.test...');
		copyFileSync(envTestSrc, '.env.test');
		console.log(`${colors.green}.env.test copied${colors.reset}`);
	} else {
		console.log(`${colors.yellow}No .env.test found in root worktree (skipping)${colors.reset}`);
	}
	console.log('');

	// Copy .claude/settings.local.json if it exists
	const claudeSettingsSrc = join(rootPath, '.claude', 'settings.local.json');
	if (existsSync(claudeSettingsSrc)) {
		console.log('Copying .claude/settings.local.json...');
		mkdirSync('.claude', { recursive: true });
		copyFileSync(claudeSettingsSrc, join('.claude', 'settings.local.json'));
		console.log(`${colors.green}.claude/settings.local.json copied${colors.reset}`);
	} else {
		console.log(
			`${colors.yellow}No .claude/settings.local.json found in root worktree (skipping)${colors.reset}`
		);
	}
	console.log('');

	console.log('Installing dependencies...');
	if (!runCommandInherit('bun', ['install'])) {
		console.error(`${colors.red}Failed to install dependencies${colors.reset}`);
		process.exit(1);
	}
	console.log(`${colors.green}Dependencies installed${colors.reset}`);
	console.log('');

	// Ensure husky hooks are executable (bun install/husky can reset the bit)
	const huskyDir = join(process.cwd(), '.husky');
	if (existsSync(huskyDir)) {
		for (const entry of readdirSync(huskyDir)) {
			const hookPath = join(huskyDir, entry);
			if (statSync(hookPath).isFile() && !entry.startsWith('_')) {
				chmodSync(hookPath, 0o755);
			}
		}
		console.log(`${colors.green}Husky hooks set as executable${colors.reset}`);
		console.log('');
	}

	const hasGt = commandExists('gt');
	let gtReady = false;

	if (hasGt) {
		console.log('Tracking branch with Graphite...');
		const tracked = runCommandInherit('gt', ['track']);
		if (!tracked) {
			console.log(
				`${colors.yellow}Warning: gt track failed (non-fatal, worktree is still usable)${colors.reset}`
			);
		} else {
			console.log(`${colors.green}Branch tracked${colors.reset}`);
		}
		console.log('');

		console.log('Syncing with trunk...');
		const synced = runCommandInherit('gt', ['sync']);
		if (!synced) {
			console.log(
				`${colors.yellow}Warning: gt sync failed (non-fatal, worktree is still usable)${colors.reset}`
			);
		} else {
			console.log(`${colors.green}Synced with trunk${colors.reset}`);
		}
		console.log('');

		gtReady = tracked && synced;
	} else {
		console.log(
			`${colors.yellow}Graphite CLI (gt) not found — skipping gt track/sync.${colors.reset}`
		);
		console.log('Install: https://graphite.dev/docs/graphite-cli/quickstart');
		console.log('');
	}

	console.log('======================================================');
	console.log(`${colors.green}Worktree setup complete!${colors.reset}`);
	console.log('======================================================');
	console.log('');
	console.log('Next steps:');
	console.log('  1. Make your changes');
	console.log('  2. Stage them: git add .');
	console.log('  3. Commit changes: git commit -m "feat: your feature"');
	if (gtReady) {
		console.log('  4. Submit PR: gt submit');
	} else {
		console.log('  4. Push & open PR: git push -u origin HEAD && gh pr create');
	}
	console.log('');
	console.log('To iterate (CI fixes, review feedback):');
	console.log('  1. Make changes');
	console.log('  2. git add .');
	console.log('  3. git commit -m "fix: address review feedback"');
	if (gtReady) {
		console.log('  4. gt submit');
	} else {
		console.log('  4. git push');
	}
	console.log('');
}

/**
 * Show help message
 */
function showHelp(): void {
	console.log('Usage:');
	console.log(
		'  bun scripts/create-worktree.ts feature/dark-mode               Create worktree with setup'
	);
	console.log(
		'  bun scripts/create-worktree.ts --setup-only                    Setup only (for Cursor UI)'
	);
	console.log(
		'  bun scripts/create-worktree.ts feature/dark-mode --open-editor cursor   Open in editor after creation'
	);
	console.log('');
	console.log('Options:');
	console.log('  -b, --base <branch>            Base branch (default: current branch)');
	console.log('  --open-editor code|cursor       Open the worktree in VS Code or Cursor');
	console.log('');
	console.log('Example:');
	console.log('  bun scripts/create-worktree.ts feature-auth');
	console.log('  bun scripts/create-worktree.ts feature-auth --open-editor cursor');
}

// Main execution
function main(): void {
	// Show help
	if (values.help) {
		showHelp();
		process.exit(0);
	}

	// SETUP-ONLY MODE (for Cursor UI)
	if (setupOnly) {
		const rootPath = getRootWorktree();
		setupWorktree(rootPath);
		process.exit(0);
	}

	// FULL MODE (create + setup)

	// Validate branch name
	if (!branchName) {
		console.error(`${colors.red}Error: Branch name is required${colors.reset}`);
		console.log('');
		console.log('Usage: bun scripts/create-worktree.ts <branch-name>');
		console.log('Example: bun scripts/create-worktree.ts feature-auth');
		process.exit(1);
	}

	console.log('');
	console.log('======================================================');
	console.log(`Creating worktree: ${branchName}`);
	console.log('======================================================');
	console.log('');

	// Get root worktree path
	const rootPath = getRootWorktree();
	console.log(`Root worktree: ${rootPath}`);

	// Determine target worktree path.
	// Worktrees live in <repo>.worktrees/ (sibling of main repo) with slashes
	// flattened to dashes. The git branch name keeps its original slashes;
	// only the on-disk folder name is flattened.
	const worktreesDir = `${rootPath}.worktrees`;
	const folderName = branchName.replace(/\//g, '-');
	const worktreePath = join(worktreesDir, folderName);
	mkdirSync(worktreesDir, { recursive: true });
	console.log(`Target worktree: ${worktreePath}`);
	console.log('');

	// Check if worktree already exists
	if (existsSync(worktreePath)) {
		console.error(
			`${colors.red}Error: Worktree directory already exists: ${worktreePath}${colors.reset}`
		);
		console.log('');
		// Explain the flattening rule unconditionally. The collision can come
		// from either direction (new branch has /, or existing branch had /),
		// and the user can't tell which from the error alone.
		console.log(
			`${colors.yellow}Note: worktree folder names flatten slashes to dashes.${colors.reset}`
		);
		console.log(
			`${colors.yellow}Branch "${branchName}" maps to folder "${folderName}".${colors.reset}`
		);
		console.log(
			`${colors.yellow}This can collide when a sibling branch exists on the other side of the mapping${colors.reset}`
		);
		console.log(
			`${colors.yellow}(e.g. "feat/sentry" and "feat-sentry" both map to "feat-sentry").${colors.reset}`
		);
		console.log(
			`${colors.yellow}Run "git worktree list" to see which branch currently owns this folder.${colors.reset}`
		);
		console.log('');
		console.log('Options:');
		console.log('  1. Choose a different branch name');
		console.log(`  2. Remove existing directory: rm -rf ${worktreePath}`);
		console.log('  3. List worktrees: git worktree list');
		process.exit(1);
	}

	// Determine base branch: current branch by default, or --base override
	const baseArg = values['base'] as string | undefined;
	let baseBranch: string;
	if (baseArg) {
		baseBranch = baseArg;
	} else {
		const result = runCommand('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { silent: true });
		if (!result.success || !result.stdout) {
			console.error(
				`${colors.red}Error: Cannot determine current branch. Use --base <branch> explicitly.${colors.reset}`
			);
			process.exit(1);
		}
		baseBranch = result.stdout;
	}
	console.log(`Base branch: ${baseBranch}`);

	// Create worktree
	console.log('Creating git worktree...');
	if (!runCommandInherit('git', ['worktree', 'add', worktreePath, '-b', branchName, baseBranch])) {
		console.error(`${colors.red}Failed to create worktree${colors.reset}`);
		process.exit(1);
	}
	console.log(`${colors.green}Worktree created${colors.reset}`);

	// Change to new worktree and run setup
	process.chdir(worktreePath);
	setupWorktree(rootPath);

	console.log(`Worktree location: ${worktreePath}`);
	console.log('');

	// Open in editor if requested
	if (openEditor) {
		console.log(`Opening in ${openEditor}...`);
		switch (openEditor) {
			case 'code':
				runCommandInherit('code', [worktreePath]);
				break;
			case 'cursor':
				runCommandInherit('cursor', [worktreePath]);
				break;
			default:
				console.log(
					`${colors.yellow}Unknown editor: ${openEditor} (supported: code, cursor)${colors.reset}`
				);
		}
		console.log('');
	} else {
		console.log('To work in this worktree:');
		console.log(`  cd ${worktreePath}`);
		console.log('');
	}
}

main();
