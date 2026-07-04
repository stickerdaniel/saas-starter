import { describe, it, expect } from 'vitest';
import type { LanguageModelUsage } from 'ai';
import {
	captureDirect,
	mergeByModel,
	readOpenRouterCost,
	type CapturedModelUsage
} from './capture';

const u = (p: Partial<CapturedModelUsage> & { model: string }): CapturedModelUsage => ({
	inputTokens: 0,
	outputTokens: 0,
	...p,
	// Mirrors captureDirect's normalization so merge inputs are realistic.
	totalTokens: p.totalTokens ?? (p.inputTokens ?? 0) + (p.outputTokens ?? 0)
});

const sdkUsage = (p: Partial<LanguageModelUsage>): LanguageModelUsage => ({
	inputTokens: undefined,
	outputTokens: undefined,
	totalTokens: undefined,
	inputTokenDetails: {
		noCacheTokens: undefined,
		cacheReadTokens: undefined,
		cacheWriteTokens: undefined
	},
	outputTokenDetails: { textTokens: undefined, reasoningTokens: undefined },
	...p
});

describe('captureDirect', () => {
	it('approximates a missing totalTokens from input + output', () => {
		// Providers may omit totalTokens; captureDirect is the single place that
		// normalizes it, so merged/persisted totals never silently drop a step.
		const out = captureDirect(sdkUsage({ inputTokens: 100, outputTokens: 50 }), undefined, 'qwen');
		expect(out.totalTokens).toBe(150);
	});

	it('passes reported totals, provider, and native cost through', () => {
		const out = captureDirect(
			sdkUsage({ inputTokens: 1, outputTokens: 2, totalTokens: 7 }),
			{ openrouter: { usage: { cost: 0.5 } } },
			'qwen',
			'openrouter'
		);
		expect(out).toMatchObject({
			model: 'qwen',
			provider: 'openrouter',
			totalTokens: 7,
			nativeCostUsd: 0.5
		});
	});
});

describe('mergeByModel', () => {
	it('sums same-model native entries and adds their native cost', () => {
		const out = mergeByModel([
			u({ model: 'qwen', inputTokens: 100, outputTokens: 10, nativeCostUsd: 0.001 }),
			u({ model: 'qwen', inputTokens: 50, outputTokens: 5, nativeCostUsd: 0.0005 })
		]);
		expect(out).toHaveLength(1);
		expect(out[0]).toMatchObject({ model: 'qwen', inputTokens: 150, outputTokens: 15 });
		expect(out[0]!.nativeCostUsd).toBeCloseTo(0.0015, 10);
	});

	it('keeps native and token-only usage of the SAME model separate', () => {
		// A model can be hit via a native-priced path (OpenRouter cost present) AND a
		// token-only path (no native cost) in the same run. They must not merge, or the
		// token-only tokens would inherit the native entry's cost and never get map-priced.
		const out = mergeByModel([
			u({ model: 'qwen', inputTokens: 1000, outputTokens: 100, nativeCostUsd: 0.0002 }),
			u({ model: 'qwen', inputTokens: 15000, outputTokens: 1500 }) // token-only, no native cost
		]);
		expect(out).toHaveLength(2);
		const native = out.find((e) => e.nativeCostUsd !== undefined)!;
		const tokens = out.find((e) => e.nativeCostUsd === undefined)!;
		expect(native.inputTokens).toBe(1000);
		expect(tokens.inputTokens).toBe(15000);
		expect(tokens.outputTokens).toBe(1500);
	});

	it('merges token-only entries of the same model together', () => {
		const out = mergeByModel([
			u({ model: 'deepseek', inputTokens: 200, outputTokens: 20 }),
			u({ model: 'deepseek', inputTokens: 300, outputTokens: 30 })
		]);
		expect(out).toHaveLength(1);
		expect(out[0]).toMatchObject({ inputTokens: 500, outputTokens: 50 });
		expect(out[0]!.nativeCostUsd).toBeUndefined();
	});

	it('sums totalTokens across merged steps, reported and approximated alike', () => {
		// First step reports its own total (160 > input + output), second step's
		// total was approximated at capture time (30). Both must survive the merge.
		const out = mergeByModel([
			u({ model: 'qwen', inputTokens: 100, outputTokens: 50, totalTokens: 160 }),
			u({ model: 'qwen', inputTokens: 20, outputTokens: 10 })
		]);
		expect(out).toHaveLength(1);
		expect(out[0]!.totalTokens).toBe(190);
	});

	it('keeps reasoning/cached undefined when no step reported them', () => {
		// Merging used to coerce absent reasoning/cached to 0, so non-reasoning
		// models persisted a spurious reasoningTokens: 0 on multi-step rows.
		const out = mergeByModel([
			u({ model: 'qwen', inputTokens: 100, outputTokens: 50 }),
			u({ model: 'qwen', inputTokens: 20, outputTokens: 10 })
		]);
		expect(out[0]!.reasoningTokens).toBeUndefined();
		expect(out[0]!.cachedInputTokens).toBeUndefined();
	});

	it('sums reasoning/cached when at least one step reports them', () => {
		const out = mergeByModel([
			u({ model: 'qwen', inputTokens: 100, outputTokens: 50, reasoningTokens: 30 }),
			u({ model: 'qwen', inputTokens: 20, outputTokens: 10, cachedInputTokens: 5 })
		]);
		expect(out[0]!.reasoningTokens).toBe(30);
		expect(out[0]!.cachedInputTokens).toBe(5);
	});
});

describe('readOpenRouterCost', () => {
	it('reads providerMetadata.openrouter.usage.cost', () => {
		expect(readOpenRouterCost({ openrouter: { usage: { cost: 0.0042 } } })).toBe(0.0042);
	});
	it('returns undefined when absent or the wrong shape', () => {
		expect(readOpenRouterCost(undefined)).toBeUndefined();
		expect(readOpenRouterCost({ openrouter: { usage: {} } })).toBeUndefined();
		expect(readOpenRouterCost({ openrouter: { usage: { cost: 'x' } } })).toBeUndefined();
	});
});
