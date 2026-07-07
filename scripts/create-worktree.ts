/**
 * Worktree management (cross-platform TypeScript version)
 *
 * New worktrees branch from a freshly fetched origin/<trunk> by default, so a
 * stale local main can never seed one with old code. Pass --base to override or
 * --no-fetch to skip the fetch.
 *
 * Contribution mode: --push-remote <remote> targets another configured remote
 * (e.g. a template repo added as `upstream`) instead of origin. The worktree
 * branches off that remote's trunk and the branch gets git's own
 * `branch.<name>.pushRemote` key, so a bare `git push` goes to that remote and
 * `worktree:prune` knows where to confirm the merged PR for cleanup.
 *
 * Usage:
 *   bun scripts/create-worktree.ts feature/dark-mode           # Full mode: create + setup
 *   bun scripts/create-worktree.ts --setup-only               # Setup mode: setup only (for Cursor)
 *   bun scripts/create-worktree.ts feature/dark-mode --open-editor cursor
 *   bun scripts/create-worktree.ts fix/typo --push-remote upstream
 */

import { spawnSync } from 'child_process';
import { chmodSync, existsSync, copyFileSync, mkdirSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { parseArgs } from 'util';
import { parseRemoteSlug } from './prune-worktrees';

// ANSI colors for terminal output
const colors = {
	reset: '\x1b[0m',
	bold: '\x1b[1m',
	green: '\x1b[32m',
	yellow: '\x1b[33m',
	red: '\x1b[31m'
};

// Parse command line arguments. strict mode rejects mistyped flags
// (e.g. --bse main) instead of silently swallowing them.
function parseCliArgs() {
	try {
		return parseArgs({
			args: Bun.argv.slice(2),
			options: {
				'setup-only': { type: 'boolean', default: false },
				'open-editor': { type: 'string' },
				base: { type: 'string', short: 'b' },
				'no-fetch': { type: 'boolean', default: false },
				'push-remote': { type: 'string' },
				help: { type: 'boolean', short: 'h', default: false }
			},
			strict: true,
			allowPositionals: true
		});
	} catch (error) {
		console.error(`\x1b[31m${error instanceof Error ? error.message : String(error)}\x1b[0m`);
		console.log('');
		console.log('Run with --help for usage.');
		process.exit(1);
	}
}
const { values, positionals } = parseCliArgs();

const setupOnly = values['setup-only'] ?? false;
const openEditor = values['open-editor'];
const branchName = positionals[0];

// A second positional is always a mistake (usually an attempted base branch);
// dropping it silently would branch off the default base instead.
if (positionals.length > 1) {
	console.error(
		`${'\x1b[31m'}Error: Unexpected extra argument(s): ${positionals.slice(1).join(' ')}${'\x1b[0m'}`
	);
	console.log('');
	console.log('To choose the base branch, pass it as a flag: --base <branch> (e.g. --base main)');
	process.exit(1);
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
 * Resolve a remote's HEAD branch name, or null when the remote's HEAD ref is
 * unset locally (e.g. a brand new clone that never ran `git remote set-head`,
 * or a hand-added remote, where it is never set automatically).
 */
function getRemoteHead(remote: string): string | null {
	const result = runCommand('git', ['symbolic-ref', '--short', `refs/remotes/${remote}/HEAD`], {
		silent: true
	});
	return result.success && result.stdout.startsWith(`${remote}/`)
		? result.stdout.slice(remote.length + 1)
		: null;
}

/**
 * Resolve the trunk branch name (the default base for new worktrees) from the
 * remote's HEAD, falling back to "main".
 */
function getTrunk(remote = 'origin'): string {
	return getRemoteHead(remote) ?? 'main';
}

/**
 * Setup worktree (copies files and installs deps)
 */
function setupWorktree(
	rootPath: string,
	contribution?: { remote: string; slug: string | null }
): void {
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

	console.log('======================================================');
	console.log(`${colors.green}Worktree setup complete!${colors.reset}`);
	console.log('======================================================');
	console.log('');
	console.log('Next steps:');
	console.log('  1. Make your changes');
	console.log('  2. Stage them: git add .');
	console.log('  3. Commit changes: git commit -m "feat: your feature"');
	if (contribution) {
		const repoFlag = contribution.slug ? ` --repo ${contribution.slug}` : '';
		console.log(`  4. Push & open PR: git push && gh pr create${repoFlag} --draft`);
		console.log(
			`     (a bare \`git push\` targets ${contribution.remote} via branch.<name>.pushRemote)`
		);
	} else {
		console.log('  4. Push & open PR: git push -u origin HEAD && gh pr create');
	}
	console.log('');
	console.log('To iterate (CI fixes, review feedback):');
	console.log('  1. Make changes');
	console.log('  2. git add .');
	console.log('  3. git commit -m "fix: address review feedback"');
	console.log('  4. git push');
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
	console.log(
		'  -b, --base <branch>            Base branch (default: origin/<trunk>, fetched fresh)'
	);
	console.log('  --no-fetch                      Skip the pre-branch git fetch (use local refs)');
	console.log('  --open-editor code|cursor       Open the worktree in VS Code or Cursor');
	console.log(
		'  --push-remote <remote>          Contribute to another remote: base off its trunk,'
	);
	console.log(
		'                                  route `git push` there, let worktree:prune clean up'
	);
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

	// Contribution mode: validate the target remote before touching git state.
	const pushRemoteRaw = values['push-remote'] as string | undefined;
	const pushRemote = pushRemoteRaw?.trim();
	if (pushRemoteRaw !== undefined && !pushRemote) {
		console.error(
			`${colors.red}Error: --push-remote requires a non-empty remote name${colors.reset}`
		);
		process.exit(1);
	}
	let pushRemoteSlug: string | null = null;
	if (pushRemote) {
		const remoteUrl = runCommand('git', ['remote', 'get-url', pushRemote], { silent: true });
		if (!remoteUrl.success) {
			console.error(`${colors.red}Error: remote "${pushRemote}" is not configured${colors.reset}`);
			console.log('');
			console.log(`Add it first: git remote add ${pushRemote} <url>`);
			const remotes = runCommand('git', ['remote'], { silent: true });
			if (remotes.stdout)
				console.log(`Configured remotes: ${remotes.stdout.split('\n').join(', ')}`);
			process.exit(1);
		}
		// Used for the `gh pr create --repo` hint; null for non-GitHub remotes.
		pushRemoteSlug = parseRemoteSlug(remoteUrl.stdout);
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

	// Determine base branch. Default is the REMOTE trunk (origin/<trunk>, or the
	// --push-remote's trunk in contribution mode), NOT the current local branch:
	// branching off the remote keeps a new worktree independent of whatever
	// stale state the local checkout is in, so a forgotten `git pull` on main
	// can no longer seed a worktree with old code. Pass --base <branch> to stack
	// intentionally (e.g. on another feature branch).
	const baseArgRaw = values['base'] as string | undefined;
	const baseArg = baseArgRaw?.trim();
	if (baseArgRaw !== undefined && !baseArg) {
		console.error(`${colors.red}Error: --base requires a non-empty branch name${colors.reset}`);
		process.exit(1);
	}
	const baseRemote = pushRemote ?? 'origin';
	const trunk = getTrunk(baseRemote);
	if (pushRemote && !getRemoteHead(pushRemote)) {
		console.log(
			`${colors.yellow}Note: ${pushRemote}/HEAD is unset; assuming trunk "${trunk}" (set it with \`git remote set-head ${pushRemote} --auto\`).${colors.reset}`
		);
	}

	// Refresh the base from the remote before branching (unless --no-fetch). This
	// is what makes "forgot to pull main" harmless: the worktree always starts
	// from the current remote trunk, not the local ref, which routinely lags.
	const noFetch = values['no-fetch'] ?? false;
	if (!noFetch) {
		console.log(baseArg ? `Fetching ${baseRemote}...` : `Fetching ${baseRemote}/${trunk}...`);
		const fetchArgs = baseArg ? ['fetch', baseRemote] : ['fetch', baseRemote, trunk];
		const fetched = runCommand('git', fetchArgs, { silent: true });
		if (!fetched.success) {
			console.log(
				`${colors.yellow}Warning: git fetch failed; branching from last-known refs.${colors.reset}`
			);
		}
	}

	const baseBranch = baseArg ?? `${baseRemote}/${trunk}`;
	console.log(`Base branch: ${baseBranch}`);
	if (baseArg && baseArg !== trunk && baseArg !== `${baseRemote}/${trunk}`) {
		console.log(
			`${colors.yellow}Note: stacking this worktree on "${baseArg}", not ${trunk}.${colors.reset}`
		);
	}

	// Create worktree
	console.log('Creating git worktree...');
	if (!runCommandInherit('git', ['worktree', 'add', worktreePath, '-b', branchName, baseBranch])) {
		console.error(`${colors.red}Failed to create worktree${colors.reset}`);
		process.exit(1);
	}
	console.log(`${colors.green}Worktree created${colors.reset}`);

	// Branching off a remote-tracking ref (<remote>/<trunk>) makes git auto-set
	// the new branch's upstream to the trunk (branch.autoSetupMerge). Unset it so
	// `git status` doesn't compare against the trunk and the first
	// `git push -u origin HEAD` sets the correct upstream.
	const unset = runCommand('git', ['-C', worktreePath, 'branch', '--unset-upstream'], {
		silent: true
	});
	// With a <remote>/<trunk> base an upstream definitely existed, so a failed
	// unset (e.g. a config.lock race with a parallel create) left the wrong
	// upstream set — warn so it gets fixed before the first push. A local --base
	// has no upstream, making the failure an expected no-op we ignore.
	if (!unset.success && baseBranch.startsWith(`${baseRemote}/`)) {
		console.log(
			`${colors.yellow}Warning: could not unset the auto-configured upstream; run \`git branch --unset-upstream\` in the worktree before pushing.${colors.reset}`
		);
	}

	// Contribution mode: stamp git's own pushRemote key. It routes a bare
	// `git push` to the contribution remote (verified with push.default=simple
	// and no upstream set) and doubles as the durable marker worktree:prune
	// reads to know where this branch's PR lives. Branch config is shared
	// repo-wide, so prune sees it from the main checkout too.
	if (pushRemote) {
		const stamped = runCommand(
			'git',
			['-C', worktreePath, 'config', `branch.${branchName}.pushRemote`, pushRemote],
			{ silent: true }
		);
		if (stamped.success) {
			console.log(
				`${colors.green}Push remote set: \`git push\` targets ${pushRemote}/${branchName}${colors.reset}`
			);
		} else {
			console.log(
				`${colors.yellow}Warning: could not set branch.${branchName}.pushRemote; set it manually: git config branch.${branchName}.pushRemote ${pushRemote}${colors.reset}`
			);
		}
	}

	// Change to new worktree and run setup
	process.chdir(worktreePath);
	setupWorktree(rootPath, pushRemote ? { remote: pushRemote, slug: pushRemoteSlug } : undefined);

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
