import { describe, expect, it, vi } from 'vitest';
import {
	normalizeIdentifier,
	pruneOldestPreview,
	selectPrunable,
	type Preview
} from './prune-previews';

const NOW = 1_700_000_000_000;
const MIN = 60 * 1000;

function preview(
	overrides: Partial<Preview> & { ageMin: number; id: string; name?: string }
): Preview {
	return {
		name: overrides.name ?? `dep-${overrides.id}`,
		previewIdentifier: overrides.id,
		createTime: NOW - overrides.ageMin * MIN,
		expiresAt: null
	};
}

describe('normalizeIdentifier', () => {
	it('lowercases and slugifies', () => {
		expect(normalizeIdentifier('Feature/Foo-Bar')).toBe('feature-foo-bar');
		expect(normalizeIdentifier('fix_329_quota')).toBe('fix-329-quota');
		expect(normalizeIdentifier('--already-slug--')).toBe('already-slug');
	});
});

describe('selectPrunable', () => {
	it('picks oldest preview older than 5 min excluding current branch', () => {
		const previews = [
			preview({ id: 'feature-a', ageMin: 120 }),
			preview({ id: 'feature-b', ageMin: 60 }),
			preview({ id: 'feature-c', ageMin: 10 })
		];
		const target = selectPrunable(previews, 'feature-c', NOW);
		expect(target?.name).toBe('dep-feature-a');
	});

	it('excludes current branch via normalized match', () => {
		const previews = [
			preview({ id: 'feature-foo-bar', ageMin: 200 }),
			preview({ id: 'other', ageMin: 100 }),
			preview({ id: 'newer', ageMin: 10 })
		];
		const target = selectPrunable(previews, 'Feature/Foo-Bar', NOW);
		expect(target?.previewIdentifier).toBe('other');
	});

	it('never prunes the absolute newest preview even when not current branch', () => {
		const previews = [
			preview({ id: 'oldest', ageMin: 200 }),
			preview({ id: 'middle', ageMin: 100 }),
			preview({ id: 'newest', ageMin: 1 })
		];
		const target = selectPrunable(previews, 'unrelated', NOW);
		expect(target?.previewIdentifier).not.toBe('newest');
		expect(target?.previewIdentifier).toBe('oldest');
	});

	it('falls back to absolute oldest when every candidate is younger than 5 min', () => {
		const previews = [
			preview({ id: 'fresh-1', ageMin: 3 }),
			preview({ id: 'fresh-2', ageMin: 2 }),
			preview({ id: 'fresh-3', ageMin: 1 })
		];
		const target = selectPrunable(previews, 'unrelated', NOW);
		expect(target?.previewIdentifier).toBe('fresh-1');
	});

	it('returns null when only candidate is current branch', () => {
		const previews = [preview({ id: 'only-one', ageMin: 100 })];
		expect(selectPrunable(previews, 'only-one', NOW)).toBeNull();
	});

	it('returns null when the only non-current-branch preview is the newest', () => {
		const previews = [
			preview({ id: 'current', ageMin: 200 }),
			preview({ id: 'newest', ageMin: 1 })
		];
		expect(selectPrunable(previews, 'current', NOW)).toBeNull();
	});

	it('returns null on empty input', () => {
		expect(selectPrunable([], 'any', NOW)).toBeNull();
	});

	it('returns null when currentBranch is null (fail-safe: never prune blindly)', () => {
		const previews = [
			preview({ id: 'a', ageMin: 200 }),
			preview({ id: 'b', ageMin: 100 }),
			preview({ id: 'c', ageMin: 10 })
		];
		expect(selectPrunable(previews, null, NOW)).toBeNull();
	});

	it('returns null when currentBranch is an empty string', () => {
		const previews = [preview({ id: 'a', ageMin: 200 }), preview({ id: 'b', ageMin: 100 })];
		expect(selectPrunable(previews, '', NOW)).toBeNull();
	});

	it('returns null when currentBranch normalizes to empty (e.g. all punctuation)', () => {
		const previews = [preview({ id: 'a', ageMin: 200 })];
		expect(selectPrunable(previews, '///', NOW)).toBeNull();
	});

	it('prunes the older preview when current branch IS the absolute newest', () => {
		// Copilot-review regression: previously the "exclude newest" filter was
		// applied to the post-current-branch-filter set, so if the current
		// branch was the absolute newest, we erroneously excluded a second
		// preview and could not prune at all when previews were scarce.
		const previews = [preview({ id: 'stale', ageMin: 200 }), preview({ id: 'current', ageMin: 1 })];
		const target = selectPrunable(previews, 'current', NOW);
		expect(target?.previewIdentifier).toBe('stale');
	});
});

describe('pruneOldestPreview', () => {
	const token = 'tok';
	const projectId = 'proj-1';

	it('deletes the selected preview and returns its name', async () => {
		const remove = vi.fn().mockResolvedValue(undefined);
		const result = await pruneOldestPreview({
			token,
			projectId,
			currentBranch: 'current',
			now: NOW,
			deps: {
				list: async () => [
					preview({ id: 'old', ageMin: 200 }),
					preview({ id: 'mid', ageMin: 60 }),
					preview({ id: 'newest', ageMin: 1 })
				],
				remove
			}
		});
		expect(result).toEqual({ pruned: 'dep-old' });
		expect(remove).toHaveBeenCalledWith(token, 'dep-old');
	});

	it('returns no-candidates when selector returns null', async () => {
		const result = await pruneOldestPreview({
			token,
			projectId,
			currentBranch: 'only',
			now: NOW,
			deps: {
				list: async () => [preview({ id: 'only', ageMin: 100 })],
				remove: vi.fn()
			}
		});
		expect(result).toEqual({ pruned: null, reason: 'no candidates' });
	});

	it('surfaces list failure', async () => {
		const result = await pruneOldestPreview({
			token,
			projectId,
			currentBranch: 'x',
			now: NOW,
			deps: {
				list: async () => {
					throw new Error('network down');
				},
				remove: vi.fn()
			}
		});
		expect(result).toEqual({ pruned: null, reason: 'list failed: network down' });
	});

	it('surfaces delete failure', async () => {
		const result = await pruneOldestPreview({
			token,
			projectId,
			currentBranch: 'current',
			now: NOW,
			deps: {
				list: async () => [
					preview({ id: 'old', ageMin: 200 }),
					preview({ id: 'newer', ageMin: 10 })
				],
				remove: async () => {
					throw new Error('403 forbidden');
				}
			}
		});
		expect(result).toEqual({ pruned: null, reason: 'delete failed: 403 forbidden' });
	});
});
