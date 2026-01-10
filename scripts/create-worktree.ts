/**
 * Worktree management with Graphite integration (cross-platform TypeScript version)
 *
 * Usage:
 *   bun scripts/create-worktree.ts <branch-name>           # Full mode: create + setup
 *   bun scripts/create-worktree.ts --setup-only            # Setup mode: setup only (for Cursor)
 *   bun scripts/create-worktree.ts <branch-name> --open-editor cursor
 */

import { spawnSync } from 'child_process';
import { existsSync, copyFileSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
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
		help: { type: 'boolean', short: 'h', default: false }
	},
	strict: false,
	allowPositionals: true
});

const setupOnly = values['setup-only'] ?? false;
const openEditor = values['open-editor'];
const branchName = positionals[0];

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
 * Get root worktree path (where .git directory is)
 */
function getRootWorktree(): string {
	const result = runCommand('git', ['rev-parse', '--show-toplevel'], { silent: true });
	if (!result.success) {
		console.error(`${colors.red}Error: Not in a git repository${colors.reset}`);
		process.exit(1);
	}
	return result.stdout;
}

/**
 * Get default branch from remote
 */
function getDefaultBranch(): string {
	const result = runCommand('git', ['symbolic-ref', 'refs/remotes/origin/HEAD', '--short'], {
		silent: true
	});

	if (result.success) {
		return result.stdout.replace('origin/', '');
	}

	return 'main';
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

	console.log('Tracking branch with Graphite...');
	if (!runCommandInherit('gt', ['track'])) {
		console.error(`${colors.red}Failed to track branch${colors.reset}`);
		process.exit(1);
	}
	console.log(`${colors.green}Branch tracked${colors.reset}`);
	console.log('');

	console.log('Syncing with trunk...');
	if (!runCommandInherit('gt', ['sync'])) {
		console.error(`${colors.red}Failed to sync${colors.reset}`);
		process.exit(1);
	}
	console.log(`${colors.green}Synced with trunk${colors.reset}`);
	console.log('');

	console.log('======================================================');
	console.log(`${colors.green}Worktree setup complete!${colors.reset}`);
	console.log('======================================================');
	console.log('');
	console.log('Next steps:');
	console.log('  1. Make your changes');
	console.log('  2. Stage them: git add .');
	console.log('  3. Commit changes: git commit -m "feat: your feature"');
	console.log('  4. Submit PR: gt submit');
	console.log('');
	console.log('To stack more changes on top:');
	console.log('  1. Make more changes');
	console.log('  2. git add .');
	console.log('  3. gt create -m "feat: another feature"  # Creates new branch');
	console.log('  4. gt submit --stack');
	console.log('');
}

/**
 * Show help message
 */
function showHelp(): void {
	console.log('Usage:');
	console.log(
		'  bun scripts/create-worktree.ts <branch-name>               Create worktree with setup'
	);
	console.log(
		'  bun scripts/create-worktree.ts --setup-only                Setup only (for Cursor UI)'
	);
	console.log(
		'  bun scripts/create-worktree.ts <branch-name> --open-editor <editor>   Open in editor after creation'
	);
	console.log('');
	console.log('Options:');
	console.log('  --open-editor code|cursor      Open the worktree in VS Code or Cursor');
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

	// Determine target worktree path
	const worktreePath = join(dirname(rootPath), branchName);
	console.log(`Target worktree: ${worktreePath}`);
	console.log('');

	// Check if worktree already exists
	if (existsSync(worktreePath)) {
		console.error(
			`${colors.red}Error: Worktree directory already exists: ${worktreePath}${colors.reset}`
		);
		console.log('');
		console.log('Options:');
		console.log('  1. Choose a different branch name');
		console.log(`  2. Remove existing directory: rm -rf ${worktreePath}`);
		console.log('  3. List worktrees: git worktree list');
		process.exit(1);
	}

	// Get default branch
	const defaultBranch = getDefaultBranch();
	console.log(`Base branch: ${defaultBranch}`);

	// Create worktree
	console.log('Creating git worktree...');
	if (
		!runCommandInherit('git', ['worktree', 'add', worktreePath, '-b', branchName, defaultBranch])
	) {
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
