import type { ActionCtx } from '../../convex/_generated/server';
import { internal } from '../../convex/_generated/api';
import type { CapturedModelUsage } from './capture';
import type { AiUsageFeatureSchema } from './schemas';

export type { CapturedModelUsage } from './capture';

export type Feature = typeof AiUsageFeatureSchema.Type;

/**
 * Fire-and-forget recorder for action call sites. No-ops when nothing was used,
 * otherwise schedules the `insert` mutation, which resolves cost and persists
 * the row.
 */
export async function recordAiUsage(
	ctx: ActionCtx,
	args: {
		userId?: string;
		feature: Feature;
		threadId?: string;
		status?: 'ok' | 'partial' | 'error';
		models: CapturedModelUsage[];
	}
): Promise<void> {
	if (args.models.length === 0) return;
	try {
		// Scheduled mutations run exactly-once with automatic retry on internal
		// errors, so a transient backend failure can't silently drop the usage
		// row the way an awaited runMutation from this action could.
		await ctx.scheduler.runAfter(0, internal.aiUsage.record.insert, args);
	} catch {
		// Metering must never fail the feature call that produced the usage:
		// callers invoke this after a successful stream/generation, so a
		// throwing schedule would surface a metering problem as an LLM failure.
		console.error({ code: 'ai_usage_record_failed', feature: args.feature });
	}
}
