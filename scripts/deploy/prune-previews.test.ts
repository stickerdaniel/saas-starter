import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	applyPreviewPrune,
	deleteDeployment,
	deletePreviewForBranch,
	listPreviewDeployments,
	normalizeIdentifier,
	planPreviewPrune,
	type ApprovedPreviewPrune,
	type Preview,
	type PruneDeps,
	type PreviewPruneInputs
} from './prune-previews';

const NOW = 1_700_000_000_000;
const MIN = 60 * 1000;
function preview(
	overrides: { ageMin: number; id: string; name?: string } & Partial<Preview>
): Preview {
	const { ageMin, id, ...fields } = overrides;
	return {
		name: fields.name ?? `dep-${id}`,
		previewIdentifier: id,
		createTime: NOW - ageMin * MIN,
		expiresAt: null,
		deploymentType: 'preview',
		...fields
	};
}
function plan(overrides: Partial<PreviewPruneInputs> = {}) {
	return planPreviewPrune({
		projectId: 'project',
		currentBranch: 'current',
		now: NOW,
		liveBranches: new Set(),
		previews: [preview({ id: 'old', ageMin: 100 }), preview({ id: 'new', ageMin: 1 })],
		...overrides
	});
}
function candidate(
	previews: Preview[],
	currentBranch: string | null,
	now: number,
	liveBranches = new Set<string>()
) {
	const result = plan({ previews, currentBranch, now, liveBranches });
	return result.kind === 'candidate' ? result.target : null;
}
function approved(overrides: Partial<PreviewPruneInputs> = {}): ApprovedPreviewPrune {
	const result = plan(overrides);
	if (result.kind !== 'candidate') throw new Error('test requires an approved plan');
	return result;
}

afterEach(() => vi.unstubAllGlobals());

describe('normalizeIdentifier', () => {
	it('lowercases and slugifies', () => {
		expect(normalizeIdentifier('Feature/Foo-Bar')).toBe('feature-foo-bar');
		expect(normalizeIdentifier('fix_329_quota')).toBe('fix-329-quota');
		expect(normalizeIdentifier('--already-slug--')).toBe('already-slug');
	});
});
describe('candidate', () => {
	it('picks oldest preview older than 5 min excluding current branch', () => {
		const previews = [
			preview({ id: 'feature-a', ageMin: 120 }),
			preview({ id: 'feature-b', ageMin: 60 }),
			preview({ id: 'feature-c', ageMin: 10 })
		];
		const target = candidate(previews, 'feature-c', NOW);
		expect(target?.name).toBe('dep-feature-a');
	});

	it('excludes current branch via normalized match', () => {
		const previews = [
			preview({ id: 'feature-foo-bar', ageMin: 200 }),
			preview({ id: 'other', ageMin: 100 }),
			preview({ id: 'newer', ageMin: 10 })
		];
		const target = candidate(previews, 'Feature/Foo-Bar', NOW);
		expect(target?.previewIdentifier).toBe('other');
	});

	it('never prunes the absolute newest preview even when not current branch', () => {
		const previews = [
			preview({ id: 'oldest', ageMin: 200 }),
			preview({ id: 'middle', ageMin: 100 }),
			preview({ id: 'newest', ageMin: 1 })
		];
		const target = candidate(previews, 'unrelated', NOW);
		expect(target?.previewIdentifier).not.toBe('newest');
		expect(target?.previewIdentifier).toBe('oldest');
	});

	it('falls back to absolute oldest when every candidate is younger than 5 min', () => {
		const previews = [
			preview({ id: 'fresh-1', ageMin: 3 }),
			preview({ id: 'fresh-2', ageMin: 2 }),
			preview({ id: 'fresh-3', ageMin: 1 })
		];
		const target = candidate(previews, 'unrelated', NOW);
		expect(target?.previewIdentifier).toBe('fresh-1');
	});

	it('returns null when only candidate is current branch', () => {
		const previews = [preview({ id: 'only-one', ageMin: 100 })];
		expect(candidate(previews, 'only-one', NOW)).toBeNull();
	});

	it('returns null when the only non-current-branch preview is the newest', () => {
		const previews = [
			preview({ id: 'current', ageMin: 200 }),
			preview({ id: 'newest', ageMin: 1 })
		];
		expect(candidate(previews, 'current', NOW)).toBeNull();
	});

	it('returns null on empty input', () => {
		expect(candidate([], 'any', NOW)).toBeNull();
	});

	it('returns null when currentBranch is null (fail-safe: never prune blindly)', () => {
		const previews = [
			preview({ id: 'a', ageMin: 200 }),
			preview({ id: 'b', ageMin: 100 }),
			preview({ id: 'c', ageMin: 10 })
		];
		expect(candidate(previews, null, NOW)).toBeNull();
	});

	it('returns null when currentBranch is an empty string', () => {
		const previews = [preview({ id: 'a', ageMin: 200 }), preview({ id: 'b', ageMin: 100 })];
		expect(candidate(previews, '', NOW)).toBeNull();
	});

	it('returns null when currentBranch normalizes to empty (e.g. all punctuation)', () => {
		const previews = [preview({ id: 'a', ageMin: 200 })];
		expect(candidate(previews, '///', NOW)).toBeNull();
	});

	it('prunes the older preview when current branch IS the absolute newest', () => {
		// Copilot-review regression: previously the "exclude newest" filter was
		// applied to the post-current-branch-filter set, so if the current
		// branch was the absolute newest, we erroneously excluded a second
		// preview and could not prune at all when previews were scarce.
		const previews = [preview({ id: 'stale', ageMin: 200 }), preview({ id: 'current', ageMin: 1 })];
		const target = candidate(previews, 'current', NOW);
		expect(target?.previewIdentifier).toBe('stale');
	});

	it('never prunes a live branch even when it is the absolute oldest', () => {
		const previews = [
			preview({ id: 'open-pr', ageMin: 500 }),
			preview({ id: 'abandoned', ageMin: 100 }),
			preview({ id: 'newest', ageMin: 1 })
		];
		const liveBranches = new Set(['open-pr']);
		const target = candidate(previews, 'unrelated', NOW, liveBranches);
		// 'open-pr' is the oldest but live, so the oldest non-live candidate wins.
		expect(target?.previewIdentifier).toBe('abandoned');
	});

	it('matches live branches via normalized identifier', () => {
		const previews = [
			preview({ id: 'Feature/Foo-Bar', ageMin: 500 }),
			preview({ id: 'abandoned', ageMin: 100 }),
			preview({ id: 'newest', ageMin: 1 })
		];
		// liveBranches is expected to already be normalized by the caller.
		const liveBranches = new Set([normalizeIdentifier('Feature/Foo-Bar')]);
		const target = candidate(previews, 'unrelated', NOW, liveBranches);
		expect(target?.previewIdentifier).toBe('abandoned');
	});

	it('returns null when every non-current/non-newest candidate is live', () => {
		const previews = [
			preview({ id: 'current', ageMin: 300 }),
			preview({ id: 'live-a', ageMin: 200 }),
			preview({ id: 'live-b', ageMin: 100 }),
			preview({ id: 'newest', ageMin: 1 })
		];
		const liveBranches = new Set(['live-a', 'live-b']);
		expect(candidate(previews, 'current', NOW, liveBranches)).toBeNull();
	});
});
describe('deletePreviewForBranch', () => {
	function deps(previews: Preview[], remove = vi.fn(async () => {})): PruneDeps {
		return { list: vi.fn(async () => previews), remove };
	}

	it('deletes exactly the preview whose identifier matches the branch', async () => {
		const remove = vi.fn(async () => {});
		const result = await deletePreviewForBranch({
			token: 't',
			projectId: 'p',
			gitRef: 'Feature/Foo-Bar',
			deps: deps(
				[preview({ id: 'feature-foo-bar', ageMin: 5 }), preview({ id: 'other', ageMin: 5 })],
				remove
			)
		});
		expect(result).toEqual({ deleted: 'dep-feature-foo-bar' });
		expect(remove).toHaveBeenCalledExactlyOnceWith('t', 'dep-feature-foo-bar', undefined);
	});

	it('never matches a prefix/suffix of another branch', async () => {
		const remove = vi.fn(async () => {});
		const result = await deletePreviewForBranch({
			token: 't',
			projectId: 'p',
			gitRef: 'fix/auth',
			deps: deps([preview({ id: 'fix-auth-2', ageMin: 5 })], remove)
		});
		expect(result).toEqual({ deleted: null, reason: 'not_found' });
		expect(remove).not.toHaveBeenCalled();
	});

	it('is an idempotent no-op when the preview is already gone', async () => {
		const remove = vi.fn(async () => {});
		const result = await deletePreviewForBranch({
			token: 't',
			projectId: 'p',
			gitRef: 'merged/branch',
			deps: deps([preview({ id: 'still-open', ageMin: 5 })], remove)
		});
		expect(result).toEqual({ deleted: null, reason: 'not_found' });
		expect(remove).not.toHaveBeenCalled();
	});

	it('rejects an empty/invalid branch without listing or deleting', async () => {
		const remove = vi.fn(async () => {});
		const list = vi.fn(async () => [] as Preview[]);
		const result = await deletePreviewForBranch({
			token: 't',
			projectId: 'p',
			gitRef: '///',
			deps: { list, remove }
		});
		expect(result).toEqual({ deleted: null, reason: 'invalid_branch' });
		expect(list).not.toHaveBeenCalled();
		expect(remove).not.toHaveBeenCalled();
	});

	it('fails closed on a normalization collision without deleting', async () => {
		const remove = vi.fn(async () => {});
		const result = await deletePreviewForBranch({
			token: 't',
			projectId: 'p',
			gitRef: 'fix/auth',
			// Two distinct identifiers that normalize to the same slug.
			deps: deps(
				[
					preview({ id: 'fix/auth', name: 'dep-a', ageMin: 5 }),
					preview({ id: 'fix-auth', name: 'dep-b', ageMin: 5 })
				],
				remove
			)
		});
		expect(result).toEqual({ deleted: null, reason: 'ambiguous' });
		expect(remove).not.toHaveBeenCalled();
	});

	it('propagates a list failure', async () => {
		const result = deletePreviewForBranch({
			token: 't',
			projectId: 'p',
			gitRef: 'feature/x',
			deps: {
				list: vi.fn(async () => {
					throw new Error('500 boom');
				}),
				remove: vi.fn(async () => {})
			}
		});
		await expect(result).rejects.toThrow('500 boom');
	});

	it('propagates a delete failure', async () => {
		const result = deletePreviewForBranch({
			token: 't',
			projectId: 'p',
			gitRef: 'feature/x',
			deps: {
				list: vi.fn(async () => [preview({ id: 'feature-x', ageMin: 5 })]),
				remove: vi.fn(async () => {
					throw new Error('403 forbidden');
				})
			}
		});
		await expect(result).rejects.toThrow('403 forbidden');
	});
});

describe('pure prune approval and apply boundary', () => {
	it('requires known remote state, but distinguishes a successful empty listing', () => {
		expect(plan({ liveBranches: null })).toEqual({
			kind: 'no_candidate',
			reason: 'live_branches_unknown'
		});
		expect(plan({ liveBranches: new Set() }).kind).toBe('candidate');
	});
	it('protects a current deployment even when its identifier differs from the branch', () => {
		expect(plan({ currentDeployment: 'dep-old' }).kind).toBe('no_candidate');
	});
	it('protects explicit environments by name and normalized branch', () => {
		expect(plan({ protectedDeployments: new Set(['dep-old']) }).kind).toBe('no_candidate');
		expect(plan({ protectedBranches: new Set(['OLD']) }).kind).toBe('no_candidate');
	});
	it.each(['prod', 'dev', 'custom', 'unknown'])(
		'cannot approve a %s deployment',
		(deploymentType) => {
			expect(
				plan({
					previews: [
						preview({ id: 'old', ageMin: 100, deploymentType }),
						preview({ id: 'new', ageMin: 1 })
					]
				}).kind
			).toBe('no_candidate');
		}
	);
	it('fails closed on duplicate names, canonical collisions, or tied oldest candidates', () => {
		for (const duplicate of [
			preview({ id: 'other', name: 'dep-old', ageMin: 50 }),
			preview({ id: 'OLD', ageMin: 50 }),
			preview({ id: 'other', ageMin: 100 })
		]) {
			expect(
				plan({
					previews: [
						preview({ id: 'old', ageMin: 100 }),
						duplicate,
						preview({ id: 'new', ageMin: 1 })
					]
				})
			).toEqual({ kind: 'no_candidate', reason: 'ambiguous_candidates' });
		}
	});
	it('protects all newest ties and rejects invalid timestamps', () => {
		expect(
			plan({ previews: [preview({ id: 'one', ageMin: 1 }), preview({ id: 'two', ageMin: 1 })] })
				.kind
		).toBe('no_candidate');
		expect(plan({ previews: [preview({ id: 'bad', ageMin: 1, createTime: NaN })] }).kind).toBe(
			'no_candidate'
		);
	});
	it('does not mutate inputs and snapshots the approved target', () => {
		const target = preview({ id: 'old', ageMin: 100 });
		const input = Object.freeze([target, preview({ id: 'new', ageMin: 1 })]);
		const result = approved({ previews: input });
		target.name = 'changed-after-planning';
		expect(result.target.name).toBe('dep-old');
		expect(Object.isFrozen(result.target)).toBe(true);
		expect(Object.isFrozen(result)).toBe(true);
	});
	it('applies exactly the approved target through the injected management client', async () => {
		const remove = vi.fn(async () => {});
		const signal = new AbortController().signal;
		await expect(
			applyPreviewPrune(approved(), {
				token: 'secret',
				projectId: 'project',
				remove,
				signal,
				timeoutMs: 50
			})
		).resolves.toEqual({ pruned: 'dep-old' });
		expect(remove).toHaveBeenCalledExactlyOnceWith('secret', 'dep-old', { signal, timeoutMs: 50 });
	});
	it('rejects unapproved inputs and a different project without calling delete', async () => {
		const remove = vi.fn(async () => {});
		const deps = { token: 'secret', projectId: 'project', remove };
		// @ts-expect-error A no-candidate outcome is not deletion authorization.
		await expect(applyPreviewPrune(plan({ previews: [] }), deps)).rejects.toThrow('approved plan');
		await expect(
			applyPreviewPrune(
				// @ts-expect-error A caller cannot construct the planner-private approval brand.
				Object.freeze({
					kind: 'candidate',
					projectId: 'project',
					target: Object.freeze(preview({ id: 'fake', ageMin: 2 }))
				}),
				deps
			)
		).rejects.toThrow('approved plan');
		await expect(
			applyPreviewPrune(approved(), { ...deps, projectId: 'another-project' })
		).rejects.toThrow('approved plan');
		expect(remove).not.toHaveBeenCalled();
	});
	it('propagates apply failures and rejects cancellation before deletion', async () => {
		const remove = vi.fn(async () => {
			throw new Error('delete failed');
		});
		await expect(
			applyPreviewPrune(approved(), { token: 't', projectId: 'project', remove })
		).rejects.toThrow('delete failed');
		await expect(
			applyPreviewPrune(approved(), {
				token: 't',
				projectId: 'project',
				remove,
				signal: AbortSignal.abort()
			})
		).rejects.toMatchObject({ code: 'aborted' });
		expect(remove).toHaveBeenCalledTimes(1);
	});
});

describe('management adapter', () => {
	it('filters non-preview types and refuses malformed preview records', async () => {
		const fetcher = vi
			.fn()
			.mockResolvedValue(
				new Response(
					JSON.stringify([
						preview({ id: 'preview', ageMin: 5 }),
						preview({ id: 'production', ageMin: 5, deploymentType: 'prod' }),
						{ name: 'unknown', previewIdentifier: 'looks-like-preview' }
					])
				)
			);
		vi.stubGlobal('fetch', fetcher);
		await expect(listPreviewDeployments('token', 'project')).resolves.toEqual([
			preview({ id: 'preview', ageMin: 5 })
		]);
		fetcher.mockResolvedValue(
			new Response(JSON.stringify([{ deploymentType: 'preview', name: 'bad' }]))
		);
		await expect(listPreviewDeployments('token', 'project')).rejects.toThrow('Invalid preview');
	});
	it('does not expose HTTP response bodies and handles empty successful deletes', async () => {
		const fetcher = vi.fn().mockResolvedValue(new Response('provider-secret', { status: 403 }));
		vi.stubGlobal('fetch', fetcher);
		await expect(listPreviewDeployments('token', 'project')).rejects.toThrow('HTTP 403');
		fetcher.mockResolvedValue(new Response(null, { status: 204 }));
		await expect(deleteDeployment('token', 'preview')).resolves.toBeUndefined();
		expect(fetcher).toHaveBeenLastCalledWith(
			'https://api.convex.dev/v1/deployments/preview/delete',
			expect.objectContaining({ method: 'POST', signal: expect.any(AbortSignal) })
		);
	});
});
