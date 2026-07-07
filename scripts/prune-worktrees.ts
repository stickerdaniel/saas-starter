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
 * Contribution branches are cleaned up too: `bun run worktree --push-remote <r>`
 * stamps `branch.<name>.pushRemote`, and branches carrying that marker are
 * confirmed against a merged PR on that remote (head SHA must equal the local
 * tip) instead of origin. Without such markers the cross-remote path is
 * skipped entirely, so single-remote clones behave exactly as before.
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
	/** Explicit `branch.<name>.pushRemote` config value, '' when unset. */
	pushRemote?: string;
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
 * Select branches created to contribute to another remote (e.g. a template
 * repo added as `upstream`). Only the explicit `branch.<name>.pushRemote`
 * marker stamped by `bun run worktree --push-remote <r>` puts a branch in this
 * set — branches without it (including fresh worktree branches, which carry no
 * tracking at all) are never candidates. On a plain single-origin clone this
 * returns [], and the whole cross-remote probe is skipped.
 */
export function selectContributionBranches(
	branches: BranchInfo[],
	opts: { originRemote: string; trunk: string; currentBranch: string | null }
): string[] {
	return branches
		.filter((b) => b.pushRemote && b.pushRemote !== opts.originRemote)
		.filter((b) => b.name !== opts.trunk && b.name !== opts.currentBranch)
		.map((b) => b.name);
}

/**
 * Extract the GitHub `owner/repo` slug from a remote URL so `gh` can be pinned
 * to the right repository with `--repo` — with several remotes configured, gh's
 * own resolution depends on ambient state like `gh repo set-default`. Returns
 * null for non-GitHub remotes; callers treat that as "cannot confirm".
 */
export function parseRemoteSlug(url: string): string | null {
	const trimmed = url.trim();
	const match =
		trimmed.match(/^https:\/\/github\.com\/([^/]+\/[^/]+?)(?:\.git)?\/?$/) ??
		trimmed.match(/^(?:ssh:\/\/)?git@github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?\/?$/);
	return match ? match[1] : null;
}

/** True iff a merged PR's recorded head SHA byte-equals the local branch tip. */
export function matchMergedPrBySha(prs: Array<{ headRefOid?: string }>, localTip: string): boolean {
	return Boolean(localTip) && prs.some((pr) => pr.headRefOid === localTip);
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

/** Resolve a remote's trunk branch name from its HEAD, falling back to "main". */
function getTrunk(remote = 'origin'): string {
	const result = runCommand('git', ['symbolic-ref', '--short', `refs/remotes/${remote}/HEAD`], {
		silent: true
	});
	return result.success && result.stdout.startsWith(`${remote}/`)
		? result.stdout.slice(remote.length + 1)
		: 'main';
}

/**
 * Read every explicit `branch.<name>.pushRemote` key in one subprocess. Read
 * from config rather than for-each-ref's `%(push:remotename)`, which also
 * reflects an ambient `remote.pushDefault` and would drag unrelated branches
 * into the contribution set.
 */
function getPushRemotes(): Map<string, string> {
	const result = runCommand('git', ['config', '--get-regexp', '^branch\\..*\\.pushremote$'], {
		silent: true
	});
	const map = new Map<string, string>();
	// git exits 1 when no key matches; that simply means no contribution branches.
	if (!result.success) return map;
	for (const line of result.stdout.split('\n')) {
		// Keys print with the variable name lowercased ("pushremote"); the branch
		// name keeps its case and may itself contain dots or slashes.
		const match = line.match(/^branch\.(.+)\.pushremote\s+(\S+)$/i);
		if (match) map.set(match[1], match[2]);
	}
	return map;
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
 * commit is not the branch tip). gh then covers squash-merges, but only when a
 * merged PR's recorded head SHA is exactly the local branch tip: a name-only
 * match would also delete commits added locally after the merged push. If
 * neither can confirm (offline, gh missing), stay 'unknown' and the caller
 * leaves the branch alone.
 */
export function classifyMerge(input: {
	ghSucceeded: boolean;
	ghShaMatchedMergedPr: boolean;
	gitAncestor: boolean;
}): MergeVerdict {
	if (input.gitAncestor) return 'merged';
	if (input.ghSucceeded) return input.ghShaMatchedMergedPr ? 'merged' : 'not-merged';
	return 'unknown';
}

/**
 * Probe gh + git to decide whether a branch's content is really merged on the
 * given remote. The gh probe is pinned to that remote's GitHub repo and
 * requires the merged PR's head SHA to byte-equal the local tip (see
 * classifyMerge).
 *
 * Contribution branches accept ONLY the SHA-matched merged PR, and the PR must
 * target the remote's trunk. Ancestry is no proof there: a fresh contribution
 * worktree with no commits of its own has tip == <remote>/<trunk>, and
 * `merge-base --is-ancestor X X` exits 0, so the ancestry shortcut would call
 * a just-created scaffold "merged" and delete it. The origin [gone] path keeps
 * ancestry because [gone] proves the branch was published and then deleted,
 * which a fresh scaffold never is.
 */
function confirmMerged(
	branch: string,
	opts: { remote: string; trunk: string; contribution?: boolean }
): MergeVerdict {
	const tip = runCommand('git', ['rev-parse', `refs/heads/${branch}`], { silent: true });
	const url = runCommand('git', ['remote', 'get-url', opts.remote], { silent: true });
	const slug = url.success ? parseRemoteSlug(url.stdout) : null;
	let ghSucceeded = false;
	let ghShaMatchedMergedPr = false;
	if (tip.success && slug) {
		const args = [
			'pr',
			'list',
			'--repo',
			slug,
			'--head',
			branch,
			'--state',
			'merged',
			'--json',
			'number,headRefOid',
			// A reused head branch name can have several merged PRs; the SHA gate
			// picks the right one out of the recent few.
			'--limit',
			'10'
		];
		if (opts.contribution) args.push('--base', opts.trunk);
		const pr = runCommand('gh', args, { silent: true });
		if (pr.success) {
			try {
				ghShaMatchedMergedPr = matchMergedPrBySha(JSON.parse(pr.stdout || '[]'), tip.stdout);
				ghSucceeded = true;
			} catch {
				// Unparseable gh output: treat as "gh could not answer", not as a no.
				ghSucceeded = false;
			}
		}
	}
	// exit 0 iff the branch tip is already an ancestor of <remote>/<trunk>.
	// Never consulted for contribution branches (see doc comment above).
	const ancestor = opts.contribution
		? { success: false }
		: runCommand(
				'git',
				['merge-base', '--is-ancestor', `refs/heads/${branch}`, `${opts.remote}/${opts.trunk}`],
				{ silent: true }
			);
	return classifyMerge({ ghSucceeded, ghShaMatchedMergedPr, gitAncestor: ancestor.success });
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

/**
 * Remove a confirmed-merged branch's worktree and delete the branch, or print
 * why it is being kept. Shared by the origin [gone] path and the contribution
 * path — deletion policy (dirty-tree skip, --force, dry-run, reflog anchor) is
 * identical for both.
 */
function pruneBranch(
	branch: string,
	verdict: MergeVerdict,
	notMergedReason: string,
	worktrees: Map<string, string>,
	opts: { dryRun: boolean; force: boolean }
): void {
	if (verdict !== 'merged') {
		const reason =
			verdict === 'not-merged' ? notMergedReason : 'cannot confirm the merge (gh unavailable)';
		console.log(
			`${colors.yellow}  skip ${branch}: ${reason}. Delete manually with \`git branch -D ${branch}\` if intended.${colors.reset}`
		);
		return;
	}

	const path = worktrees.get(branch);
	if (path) {
		const dirty = runCommand('git', ['-C', path, 'status', '--porcelain'], { silent: true });
		if (dirty.stdout && !opts.force) {
			console.log(
				`${colors.yellow}  skip ${branch}: merged, but its worktree has uncommitted changes (use --force to discard).${colors.reset}`
			);
			console.log(`       ${path}`);
			return;
		}
		if (opts.dryRun) {
			console.log(`  [dry-run] would remove worktree ${path} and branch ${branch} (merged)`);
			return;
		}
		const removeArgs = ['worktree', 'remove', path];
		if (opts.force) removeArgs.push('--force');
		const removed = runCommand('git', removeArgs);
		if (!removed.success) {
			console.log(
				`${colors.yellow}  could not remove worktree ${path}; leaving branch ${branch} in place.${colors.reset}`
			);
			return;
		}
		console.log(`${colors.green}  removed worktree ${path}${colors.reset}`);
	}
	if (opts.dryRun) {
		if (!path) console.log(`  [dry-run] would delete branch ${branch} (merged)`);
		return;
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
	const pushRemotes = getPushRemotes();
	const branches: BranchInfo[] = refList.stdout
		.split('\n')
		.filter(Boolean)
		.map((line) => {
			const [name, track = ''] = line.split('|');
			return { name, track, pushRemote: pushRemotes.get(name) ?? '' };
		});

	const contribution = selectContributionBranches(branches, {
		originRemote: 'origin',
		trunk,
		currentBranch
	});
	const contributionSet = new Set(contribution);
	// A branch with an explicit non-origin pushRemote lives on that remote, so
	// probe it there even if a stale origin tracking ref also reads [gone].
	const gone = selectGoneBranches(branches, { trunk, currentBranch }).filter(
		(b) => !contributionSet.has(b)
	);
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
			const verdict = confirmMerged(branch, { remote: 'origin', trunk });
			pruneBranch(
				branch,
				verdict,
				'remote deleted without a merged PR matching the local tip',
				worktrees,
				{
					dryRun,
					force
				}
			);
		}
	}

	if (contribution.length > 0) {
		console.log('');
		console.log(
			`Found ${contribution.length} contribution branch(es) with a non-origin push remote; verifying merge status:`
		);
		console.log('');
		for (const branch of contribution) {
			const remote = pushRemotes.get(branch);
			if (!remote) continue;
			const verdict = confirmMerged(branch, {
				remote,
				trunk: getTrunk(remote),
				contribution: true
			});
			pruneBranch(branch, verdict, `no merged PR on ${remote} matching the local tip`, worktrees, {
				dryRun,
				force
			});
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
