import { describe, it, expect } from 'vitest';
import { mergeByModel, readOpenRouterCost, type CapturedModelUsage } from './capture';

const u = (p: Partial<CapturedModelUsage> & { model: string }): CapturedModelUsage => ({
	inputTokens: 0,
	outputTokens: 0,
	...p
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
