import { openrouter } from '@openrouter/ai-sdk-provider';
import type { LanguageModelUsage } from 'ai';
import type { LanguageModelV3 } from '@ai-sdk/provider';

export type CapturedModelUsage = {
	model: string;
	provider?: string;
	inputTokens: number;
	outputTokens: number;
	totalTokens?: number;
	reasoningTokens?: number;
	cachedInputTokens?: number;
	nativeCostUsd?: number;
};

// providerMetadata is Record<string, JSONObject> -> read defensively, no hard cast.
export function readOpenRouterCost(pm: unknown): number | undefined {
	const usage = (pm as { openrouter?: { usage?: { cost?: unknown } } } | undefined)?.openrouter
		?.usage;
	return typeof usage?.cost === 'number' ? usage.cost : undefined;
}

// Uniformly enable native cost accounting on every OpenRouter model we build.
// Without usage:{include:true}, @openrouter/ai-sdk-provider 2.9.0 returns NO cost.
export function orModel(modelId: string, opts?: Record<string, unknown>): LanguageModelV3 {
	return openrouter(modelId, { usage: { include: true }, ...opts });
}

export function captureDirect(
	usage: LanguageModelUsage,
	pm: unknown,
	model: string
): CapturedModelUsage {
	return {
		model,
		inputTokens: usage.inputTokens ?? 0,
		outputTokens: usage.outputTokens ?? 0,
		totalTokens: usage.totalTokens,
		reasoningTokens: usage.reasoningTokens,
		cachedInputTokens: usage.cachedInputTokens,
		nativeCostUsd: readOpenRouterCost(pm)
	};
}

// Collapse steps of the same model into one entry (agent multi-step / fan-out).
// Native-priced vs token-only usage of the same model are kept as separate entries
// so the token-only tokens get map-priced instead of inheriting the native entry's
// cost: that native cost only covers the native-priced tokens, so merging would let
// the recorder skip map-pricing the token-only tokens and undercount the run.
export function mergeByModel(steps: CapturedModelUsage[]): CapturedModelUsage[] {
	const byModel = new Map<string, CapturedModelUsage>();
	for (const s of steps) {
		const key = `${s.model} ${s.nativeCostUsd !== undefined ? 'native' : 'tokens'}`;
		const prev = byModel.get(key);
		if (!prev) {
			// Approximate a missing totalTokens on insert too, not just on merge:
			// otherwise a first step without totalTokens contributes 0 to the
			// merged total and the persisted row undercounts. Same fallback the
			// recorder applies (record.ts).
			byModel.set(key, { ...s, totalTokens: s.totalTokens ?? s.inputTokens + s.outputTokens });
			continue;
		}
		prev.inputTokens += s.inputTokens;
		prev.outputTokens += s.outputTokens;
		prev.totalTokens = (prev.totalTokens ?? 0) + (s.totalTokens ?? s.inputTokens + s.outputTokens);
		// Keep reasoning/cached undefined when no step reported them, so merged
		// rows of non-reasoning models don't persist a spurious 0 (the recorder
		// only stores these fields when present).
		if (prev.reasoningTokens !== undefined || s.reasoningTokens !== undefined) {
			prev.reasoningTokens = (prev.reasoningTokens ?? 0) + (s.reasoningTokens ?? 0);
		}
		if (prev.cachedInputTokens !== undefined || s.cachedInputTokens !== undefined) {
			prev.cachedInputTokens = (prev.cachedInputTokens ?? 0) + (s.cachedInputTokens ?? 0);
		}
		if (s.nativeCostUsd !== undefined)
			prev.nativeCostUsd = (prev.nativeCostUsd ?? 0) + s.nativeCostUsd;
	}
	return [...byModel.values()];
}
