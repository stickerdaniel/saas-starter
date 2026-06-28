import type { UsageHandler } from '@convex-dev/agent';
import { type CapturedModelUsage, mergeByModel, readOpenRouterCost } from './capture';

export function makeAgentUsageSink() {
	const steps: CapturedModelUsage[] = [];
	const usageHandler: UsageHandler = (_ctx, a) => {
		steps.push({
			model: a.model,
			provider: a.provider,
			inputTokens: a.usage.inputTokens ?? 0,
			outputTokens: a.usage.outputTokens ?? 0,
			totalTokens: a.usage.totalTokens,
			reasoningTokens: a.usage.reasoningTokens,
			cachedInputTokens: a.usage.cachedInputTokens,
			nativeCostUsd: readOpenRouterCost(a.providerMetadata)
		});
	};
	return { usageHandler, collect: () => mergeByModel(steps) };
}
