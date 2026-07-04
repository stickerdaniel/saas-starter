import type { UsageHandler } from '@convex-dev/agent';
import { type CapturedModelUsage, captureDirect, mergeByModel } from './capture';

export function makeAgentUsageSink() {
	const steps: CapturedModelUsage[] = [];
	const usageHandler: UsageHandler = (_ctx, a) => {
		steps.push(captureDirect(a.usage, a.providerMetadata, a.model, a.provider));
	};
	return { usageHandler, collect: () => mergeByModel(steps) };
}
