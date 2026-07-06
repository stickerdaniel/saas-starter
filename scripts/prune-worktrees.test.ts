import { describe, expect, it } from 'vitest';
import {
	classifyMerge,
	parseWorktreePorcelain,
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
		expect(classifyMerge({ ghSucceeded: false, ghFoundMergedPr: false, gitAncestor: true })).toBe(
			'merged'
		);
		// ancestry wins even when gh ran and found no merged PR
		expect(classifyMerge({ ghSucceeded: true, ghFoundMergedPr: false, gitAncestor: true })).toBe(
			'merged'
		);
	});

	it('treats a merged PR as merged (covers squash-merges, no ancestry)', () => {
		expect(classifyMerge({ ghSucceeded: true, ghFoundMergedPr: true, gitAncestor: false })).toBe(
			'merged'
		);
	});

	it('is not-merged when gh ran but found no merged PR and there is no ancestry', () => {
		expect(classifyMerge({ ghSucceeded: true, ghFoundMergedPr: false, gitAncestor: false })).toBe(
			'not-merged'
		);
	});

	it('is unknown when gh could not run and there is no ancestry', () => {
		expect(classifyMerge({ ghSucceeded: false, ghFoundMergedPr: false, gitAncestor: false })).toBe(
			'unknown'
		);
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
