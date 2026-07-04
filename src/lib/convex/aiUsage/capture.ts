import { openrouter } from '@openrouter/ai-sdk-provider';
import type { LanguageModelUsage } from 'ai';
import type { LanguageModelV3 } from '@ai-sdk/provider';

export type CapturedModelUsage = {
	model: string;
	provider?: string;
	inputTokens: number;
	outputTokens: number;
	totalTokens: number;
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

// Sum two optional counters, staying undefined when neither side reported one,
// so merged/aggregated rows don't persist a spurious 0 (the recorder only
// stores these fields when present).
export function sumOptional(a: number | undefined, b: number | undefined): number | undefined {
	return a === undefined && b === undefined ? undefined : (a ?? 0) + (b ?? 0);
}

export function captureDirect(
	usage: LanguageModelUsage,
	pm: unknown,
	model: string,
	provider?: string
): CapturedModelUsage {
	const inputTokens = usage.inputTokens ?? 0;
	const outputTokens = usage.outputTokens ?? 0;
	return {
		model,
		...(provider !== undefined ? { provider } : {}),
		inputTokens,
		outputTokens,
		// Providers may omit totalTokens; approximate it once here so every
		// downstream consumer (merge, recorder) can rely on it being present.
		totalTokens: usage.totalTokens ?? inputTokens + outputTokens,
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
			byModel.set(key, { ...s });
			continue;
		}
		prev.inputTokens += s.inputTokens;
		prev.outputTokens += s.outputTokens;
		prev.totalTokens += s.totalTokens;
		prev.reasoningTokens = sumOptional(prev.reasoningTokens, s.reasoningTokens);
		prev.cachedInputTokens = sumOptional(prev.cachedInputTokens, s.cachedInputTokens);
		if (s.nativeCostUsd !== undefined)
			prev.nativeCostUsd = (prev.nativeCostUsd ?? 0) + s.nativeCostUsd;
	}
	return [...byModel.values()];
}
