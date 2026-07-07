/**
 * Prune merged worktrees + local branches after PRs land, and fast-forward the
 * local trunk when it is safe to do so.
 *
 * After `gh pr merge --squash --delete-branch`, the remote branch is gone but
 * the local branch and its worktree linger. Left alone they pile up, and a
 * leftover branch also keeps its Convex preview deployment alive (eating deploy
 * quota). This finds every local branch whose upstream was deleted on the
 * remote, confirms via a merged GitHub PR (or git ancestry) that its content is
 * actually in trunk, then removes its worktree, deletes the branch, prunes
 * stale worktree metadata, and finally fast-forwards the trunk in the main
 * checkout when that checkout is clean and has not diverged.
 *
 * Usage:
 *   bun scripts/prune-worktrees.ts            # remove merged worktrees + branches, ff trunk
 *   bun scripts/prune-worktrees.ts --dry-run  # show what would be removed, change nothing
 *   bun scripts/prune-worktrees.ts --force    # also remove worktrees with uncommitted changes
 */

import { spawnSync } from 'child_process';
import { parseArgs } from 'util';

const colors = {
	reset: '\x1b[0m',
	bold: '\x1b[1m',
	green: '\x1b[32m',
	yellow: '\x1b[33m',
	red: '\x1b[31m'
};

function runCommand(
	command: string,
	args: string[],
	options?: { silent?: boolean }
): { success: boolean; stdout: string; stderr: string } {
	const result = spawnSync(command, args, { encoding: 'utf-8' });
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

export interface BranchInfo {
	name: string;
	/** `git`'s upstream track marker, e.g. '[gone]', '[behind 2]', '[ahead 1]', ''. */
	track: string;
}

/**
 * Select local branches that are safe to delete: their upstream was deleted on
 * the remote ('[gone]' = the PR merged and `--delete-branch` removed it),
 * excluding the trunk and the currently checked-out branch. '[gone]' is the
 * reliable signal here because squash-merges do not register as `--merged`.
 */
export function selectGoneBranches(
	branches: BranchInfo[],
	opts: { trunk: string; currentBranch: string | null }
): string[] {
	return branches
		.filter((b) => b.track === '[gone]')
		.filter((b) => b.name !== opts.trunk && b.name !== opts.currentBranch)
		.map((b) => b.name);
}

/**
 * Parse `git worktree list --porcelain` into a branch-name -> worktree-path map.
 * Detached-HEAD worktrees have no `branch` line and are simply omitted.
 */
export function parseWorktreePorcelain(stdout: string): Map<string, string> {
	const map = new Map<string, string>();
	let currentPath: string | null = null;
	for (const rawLine of stdout.split('\n')) {
		const line = rawLine.trim();
		if (line.startsWith('worktree ')) {
			currentPath = line.slice('worktree '.length);
		} else if (line.startsWith('branch ') && currentPath) {
			const branch = line.slice('branch '.length).replace(/^refs\/heads\//, '');
			map.set(branch, currentPath);
		} else if (line === '') {
			currentPath = null;
		}
	}
	return map;
}

/** First line of `git worktree list --porcelain` is always the main worktree. */
function getRootWorktree(): string {
	const result = runCommand('git', ['worktree', 'list', '--porcelain'], { silent: true });
	if (!result.success || !result.stdout) {
		console.error(`${colors.red}Error: Not in a git repository${colors.reset}`);
		process.exit(1);
	}
	return result.stdout
		.split('\n')[0]
		.trim()
		.replace(/^worktree /, '');
}

/** Resolve the trunk branch name from origin's HEAD, falling back to "main". */
function getTrunk(): string {
	const result = runCommand('git', ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], {
		silent: true
	});
	return result.success && result.stdout ? result.stdout.replace(/^origin\//, '') : 'main';
}

export type MergeVerdict = 'merged' | 'not-merged' | 'unknown';

/**
 * Decide whether a [gone] branch is safe to delete, from the raw probe results.
 * '[gone]' alone only means the upstream was deleted on the remote — which also
 * happens when a PR is closed unmerged or a branch is deleted by hand — so it is
 * never sufficient on its own.
 *
 * git ancestry ranks first: if the branch tip is already an ancestor of trunk,
 * its content is provably in trunk and deleting it can't lose work, regardless
 * of gh. It catches real merges/rebases but never squash-merges (the squash
 * commit is not the branch tip). gh then covers squash-merges: a merged PR head
 * is authoritative. If neither can confirm (offline, gh missing), stay 'unknown'
 * and the caller leaves the branch alone.
 */
export function classifyMerge(input: {
	ghSucceeded: boolean;
	ghFoundMergedPr: boolean;
	gitAncestor: boolean;
}): MergeVerdict {
	if (input.gitAncestor) return 'merged';
	if (input.ghSucceeded) return input.ghFoundMergedPr ? 'merged' : 'not-merged';
	return 'unknown';
}

/** Probe gh + git to decide whether a [gone] branch's content is really in trunk. */
function confirmMerged(branch: string, trunk: string): MergeVerdict {
	const pr = runCommand(
		'gh',
		['pr', 'list', '--head', branch, '--state', 'merged', '--json', 'number', '--limit', '1'],
		{ silent: true }
	);
	// exit 0 iff the branch tip is already an ancestor of origin/<trunk>.
	const ancestor = runCommand('git', ['merge-base', '--is-ancestor', branch, `origin/${trunk}`], {
		silent: true
	});
	return classifyMerge({
		ghSucceeded: pr.success,
		ghFoundMergedPr: pr.success && pr.stdout !== '' && pr.stdout !== '[]',
		gitAncestor: ancestor.success
	});
}

/**
 * Fast-forward the trunk in the main checkout — best effort only. We never
 * reset, stash, or force: the main checkout often carries uncommitted work, so
 * a dirty tree means `merge --ff-only` would abort anyway. Skip it and leave
 * that work untouched. New worktrees already branch off origin/<trunk>, so a
 * lagging local trunk is only cosmetic.
 */
function fastForwardTrunk(rootPath: string, trunk: string, dryRun: boolean): void {
	const head = runCommand('git', ['-C', rootPath, 'rev-parse', '--abbrev-ref', 'HEAD'], {
		silent: true
	});
	if (head.stdout !== trunk) {
		console.log(
			`${colors.yellow}Skipping trunk fast-forward: "${head.stdout}" is checked out in the main worktree, not "${trunk}".${colors.reset}`
		);
		return;
	}
	const dirty = runCommand('git', ['-C', rootPath, 'status', '--porcelain'], { silent: true });
	if (dirty.stdout) {
		console.log(
			`${colors.yellow}Skipping trunk fast-forward: main checkout has uncommitted changes.${colors.reset}`
		);
		return;
	}
	const behind = runCommand(
		'git',
		['-C', rootPath, 'rev-list', '--count', `${trunk}..origin/${trunk}`],
		{ silent: true }
	);
	if (!behind.success || behind.stdout === '0') {
		console.log(`${colors.green}Local ${trunk} already up to date with origin.${colors.reset}`);
		return;
	}
	// origin is ahead. If the local trunk ALSO has commits origin lacks, it has
	// diverged and --ff-only cannot help — skip with a clear message instead of
	// letting the merge fail on a clean tree.
	const ahead = runCommand(
		'git',
		['-C', rootPath, 'rev-list', '--count', `origin/${trunk}..${trunk}`],
		{ silent: true }
	);
	if (ahead.success && ahead.stdout !== '0') {
		console.log(
			`${colors.yellow}Skipping trunk fast-forward: local ${trunk} diverged (${ahead.stdout} local commit(s), ${behind.stdout} on origin). Reconcile manually.${colors.reset}`
		);
		return;
	}
	if (dryRun) {
		console.log(`[dry-run] would fast-forward ${trunk} by ${behind.stdout} commit(s)`);
		return;
	}
	const ff = runCommand('git', ['-C', rootPath, 'merge', '--ff-only', `origin/${trunk}`]);
	if (ff.success) {
		console.log(
			`${colors.green}Fast-forwarded ${trunk} by ${behind.stdout} commit(s).${colors.reset}`
		);
	}
}

function main(): void {
	const { values } = parseArgs({
		args: Bun.argv.slice(2),
		options: {
			'dry-run': { type: 'boolean', default: false },
			force: { type: 'boolean', default: false },
			help: { type: 'boolean', short: 'h', default: false }
		},
		strict: true,
		allowPositionals: false
	});

	if (values.help) {
		console.log('Usage:');
		console.log(
			'  bun scripts/prune-worktrees.ts            Remove merged worktrees + branches, ff trunk'
		);
		console.log(
			'  bun scripts/prune-worktrees.ts --dry-run  Show what would be removed, change nothing'
		);
		console.log(
			'  bun scripts/prune-worktrees.ts --force    Discard uncommitted changes in a merged worktree too'
		);
		process.exit(0);
	}

	const dryRun = values['dry-run'] ?? false;
	const force = values.force ?? false;

	const rootPath = getRootWorktree();
	const trunk = getTrunk();

	console.log('');
	console.log('======================================================');
	console.log(`Pruning merged worktrees${dryRun ? ' (dry run)' : ''}`);
	console.log('======================================================');
	console.log('');

	// Refresh remote-tracking refs and drop the ones deleted on the remote, so
	// merged branches surface as [gone] below.
	console.log('Fetching origin (pruning deleted remote branches)...');
	const fetched = runCommand('git', ['fetch', 'origin', '--prune'], { silent: true });
	if (!fetched.success) {
		console.log(
			`${colors.yellow}Warning: git fetch failed; [gone] status may be stale. Deletion still requires a confirmed merge, so no unmerged work is at risk.${colors.reset}`
		);
	}

	const currentBranch =
		runCommand('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { silent: true }).stdout || null;

	const refList = runCommand(
		'git',
		['for-each-ref', '--format=%(refname:short)|%(upstream:track)', 'refs/heads/'],
		{ silent: true }
	);
	const branches: BranchInfo[] = refList.stdout
		.split('\n')
		.filter(Boolean)
		.map((line) => {
			const [name, track = ''] = line.split('|');
			return { name, track };
		});

	const gone = selectGoneBranches(branches, { trunk, currentBranch });
	const worktrees = parseWorktreePorcelain(
		runCommand('git', ['worktree', 'list', '--porcelain'], { silent: true }).stdout
	);

	if (gone.length === 0) {
		console.log(`${colors.green}No local branches with a deleted remote to check.${colors.reset}`);
	} else {
		console.log(
			`Found ${gone.length} local branch(es) whose remote was deleted; verifying merge status:`
		);
		console.log('');
		for (const branch of gone) {
			// [gone] is only a prefilter. Never delete without a confirmed merge:
			// a closed-unmerged PR or a hand-deleted remote is also [gone], and
			// `branch -D` would be unrecoverable loss of committed work.
			const verdict = confirmMerged(branch, trunk);
			if (verdict !== 'merged') {
				const reason =
					verdict === 'not-merged'
						? 'remote deleted without a merged PR'
						: 'cannot confirm the merge (gh unavailable)';
				console.log(
					`${colors.yellow}  skip ${branch}: ${reason}. Delete manually with \`git branch -D ${branch}\` if intended.${colors.reset}`
				);
				continue;
			}

			const path = worktrees.get(branch);
			if (path) {
				const dirty = runCommand('git', ['-C', path, 'status', '--porcelain'], { silent: true });
				if (dirty.stdout && !force) {
					console.log(
						`${colors.yellow}  skip ${branch}: merged, but its worktree has uncommitted changes (use --force to discard).${colors.reset}`
					);
					console.log(`       ${path}`);
					continue;
				}
				if (dryRun) {
					console.log(`  [dry-run] would remove worktree ${path} and branch ${branch} (merged)`);
					continue;
				}
				const removeArgs = ['worktree', 'remove', path];
				if (force) removeArgs.push('--force');
				const removed = runCommand('git', removeArgs);
				if (!removed.success) {
					console.log(
						`${colors.yellow}  could not remove worktree ${path}; leaving branch ${branch} in place.${colors.reset}`
					);
					continue;
				}
				console.log(`${colors.green}  removed worktree ${path}${colors.reset}`);
			}
			if (dryRun) {
				if (!path) console.log(`  [dry-run] would delete branch ${branch} (merged)`);
				continue;
			}
			const deleted = runCommand('git', ['branch', '-D', branch], { silent: true });
			if (deleted.success) {
				// git prints "Deleted branch X (was <sha>)"; surface the sha as a
				// reflog anchor in case a deletion ever needs undoing.
				const wasSha = deleted.stdout.match(/\(was [0-9a-f]+\)/)?.[0] ?? '';
				console.log(`${colors.green}  deleted branch ${branch} ${wasSha}${colors.reset}`);
			} else {
				console.log(`${colors.yellow}  could not delete branch ${branch}${colors.reset}`);
			}
		}
	}

	console.log('');
	// Clean up administrative files for worktrees whose directory is already gone.
	if (dryRun) {
		console.log('[dry-run] would run git worktree prune');
	} else {
		runCommand('git', ['worktree', 'prune']);
		console.log(`${colors.green}Pruned stale worktree metadata.${colors.reset}`);
	}

	console.log('');
	fastForwardTrunk(rootPath, trunk, dryRun);
	console.log('');
}

// Only run when executed directly, so the pure helpers above can be unit-tested.
if (import.meta.main) {
	main();
}
