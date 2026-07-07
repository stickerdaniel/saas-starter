import { describe, expect, it } from 'vitest';
import {
	classifyMerge,
	matchMergedPrBySha,
	parseRemoteSlug,
	parseWorktreePorcelain,
	selectContributionBranches,
	selectGoneBranches,
	type BranchInfo
} from './prune-worktrees';

describe('selectGoneBranches', () => {
	const branches: BranchInfo[] = [
		{ name: 'main', track: '' },
		{ name: 'feat/merged-a', track: '[gone]' },
		{ name: 'feat/merged-b', track: '[gone]' },
		{ name: 'feat/in-progress', track: '[ahead 2]' },
		{ name: 'feat/behind', track: '[behind 1]' },
		{ name: 'feat/never-pushed', track: '' }
	];

	it('selects only branches whose upstream is gone', () => {
		expect(selectGoneBranches(branches, { trunk: 'main', currentBranch: 'main' })).toEqual([
			'feat/merged-a',
			'feat/merged-b'
		]);
	});

	it('never selects the trunk even if it somehow reads as gone', () => {
		const withGoneTrunk: BranchInfo[] = [{ name: 'main', track: '[gone]' }, ...branches.slice(1)];
		const result = selectGoneBranches(withGoneTrunk, { trunk: 'main', currentBranch: 'feat/x' });
		expect(result).not.toContain('main');
	});

	it('never selects the currently checked-out branch', () => {
		const result = selectGoneBranches(branches, {
			trunk: 'main',
			currentBranch: 'feat/merged-a'
		});
		expect(result).toEqual(['feat/merged-b']);
	});

	it('returns empty when nothing is gone', () => {
		const clean: BranchInfo[] = [
			{ name: 'main', track: '' },
			{ name: 'feat/active', track: '[ahead 1]' }
		];
		expect(selectGoneBranches(clean, { trunk: 'main', currentBranch: 'main' })).toEqual([]);
	});
});

describe('classifyMerge', () => {
	it('treats git ancestry as merged regardless of gh (proof content is in trunk)', () => {
		expect(
			classifyMerge({ ghSucceeded: false, ghShaMatchedMergedPr: false, gitAncestor: true })
		).toBe('merged');
		// ancestry wins even when gh ran and found no merged PR
		expect(
			classifyMerge({ ghSucceeded: true, ghShaMatchedMergedPr: false, gitAncestor: true })
		).toBe('merged');
	});

	it('treats a SHA-matched merged PR as merged (covers squash-merges, no ancestry)', () => {
		expect(
			classifyMerge({ ghSucceeded: true, ghShaMatchedMergedPr: true, gitAncestor: false })
		).toBe('merged');
	});

	it('is not-merged when gh ran but no merged PR matches the tip (no ancestry)', () => {
		// This also covers the amend-after-merge case: a merged PR exists for the
		// branch name, but the local tip moved past the merged head, so the SHA
		// no longer matches and the branch must be kept.
		expect(
			classifyMerge({ ghSucceeded: true, ghShaMatchedMergedPr: false, gitAncestor: false })
		).toBe('not-merged');
	});

	it('is unknown when gh could not run and there is no ancestry', () => {
		expect(
			classifyMerge({ ghSucceeded: false, ghShaMatchedMergedPr: false, gitAncestor: false })
		).toBe('unknown');
	});
});

describe('selectContributionBranches', () => {
	const opts = { originRemote: 'origin', trunk: 'main', currentBranch: 'main' };

	it('returns [] when no branch carries a non-origin pushRemote (single-origin contract)', () => {
		// This encodes the common-path guarantee: without an explicit opt-in
		// marker, the cross-remote probe must never run, so fresh worktree
		// branches (no tracking, no marker) can never become deletion candidates.
		const branches: BranchInfo[] = [
			{ name: 'main', track: '' },
			{ name: 'feat/fresh-worktree', track: '', pushRemote: '' },
			{ name: 'feat/tracked', track: '[ahead 1]', pushRemote: 'origin' },
			{ name: 'feat/gone', track: '[gone]' }
		];
		expect(selectContributionBranches(branches, opts)).toEqual([]);
	});

	it('selects exactly the branches tagged with a non-origin pushRemote', () => {
		const branches: BranchInfo[] = [
			{ name: 'main', track: '' },
			{ name: 'fix/template-bug', track: '', pushRemote: 'upstream' },
			{ name: 'feat/normal', track: '[ahead 1]', pushRemote: '' }
		];
		expect(selectContributionBranches(branches, opts)).toEqual(['fix/template-bug']);
	});

	it('never selects the trunk or the currently checked-out branch', () => {
		const branches: BranchInfo[] = [
			{ name: 'main', track: '', pushRemote: 'upstream' },
			{ name: 'fix/current', track: '', pushRemote: 'upstream' },
			{ name: 'fix/other', track: '', pushRemote: 'upstream' }
		];
		expect(
			selectContributionBranches(branches, {
				originRemote: 'origin',
				trunk: 'main',
				currentBranch: 'fix/current'
			})
		).toEqual(['fix/other']);
	});
});

describe('matchMergedPrBySha', () => {
	const tip = 'bc47d0fcfd5d62d2bd657d156532fb863b7cae86';

	it('matches only when a merged PR head SHA equals the local tip exactly', () => {
		expect(matchMergedPrBySha([{ headRefOid: tip }], tip)).toBe(true);
		expect(matchMergedPrBySha([{ headRefOid: 'aaaa' }, { headRefOid: tip }], tip)).toBe(true);
	});

	it('rejects name-only matches at a different SHA (amend-after-merge)', () => {
		expect(matchMergedPrBySha([{ headRefOid: 'aaaa' }], tip)).toBe(false);
	});

	it('rejects empty PR lists and empty tips', () => {
		expect(matchMergedPrBySha([], tip)).toBe(false);
		expect(matchMergedPrBySha([{ headRefOid: '' }], '')).toBe(false);
	});
});

describe('parseRemoteSlug', () => {
	it('parses https URLs with and without .git', () => {
		expect(parseRemoteSlug('https://github.com/stickerdaniel/saas-starter.git')).toBe(
			'stickerdaniel/saas-starter'
		);
		expect(parseRemoteSlug('https://github.com/stickerdaniel/saas-starter')).toBe(
			'stickerdaniel/saas-starter'
		);
		expect(parseRemoteSlug('https://github.com/stickerdaniel/saas-starter/')).toBe(
			'stickerdaniel/saas-starter'
		);
	});

	it('parses ssh URLs (scp-like and ssh://)', () => {
		expect(parseRemoteSlug('git@github.com:owner/repo.git')).toBe('owner/repo');
		expect(parseRemoteSlug('ssh://git@github.com/owner/repo.git')).toBe('owner/repo');
	});

	it('returns null for non-GitHub or malformed URLs (caller keeps the branch)', () => {
		expect(parseRemoteSlug('https://gitlab.com/owner/repo.git')).toBeNull();
		expect(parseRemoteSlug('/local/path/repo.git')).toBeNull();
		expect(parseRemoteSlug('')).toBeNull();
	});
});

describe('parseWorktreePorcelain', () => {
	it('maps branch names to worktree paths', () => {
		const stdout = [
			'worktree /repo',
			'HEAD abc123',
			'branch refs/heads/main',
			'',
			'worktree /repo.worktrees/feat-a',
			'HEAD def456',
			'branch refs/heads/feat/a',
			''
		].join('\n');
		const map = parseWorktreePorcelain(stdout);
		expect(map.get('main')).toBe('/repo');
		expect(map.get('feat/a')).toBe('/repo.worktrees/feat-a');
		expect(map.size).toBe(2);
	});

	it('omits detached-HEAD worktrees (no branch line)', () => {
		const stdout = [
			'worktree /repo',
			'HEAD abc123',
			'branch refs/heads/main',
			'',
			'worktree /repo.worktrees/detached',
			'HEAD def456',
			'detached',
			''
		].join('\n');
		const map = parseWorktreePorcelain(stdout);
		expect(map.size).toBe(1);
		expect(map.has('main')).toBe(true);
	});
});
