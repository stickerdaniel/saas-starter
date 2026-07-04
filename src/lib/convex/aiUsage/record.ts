import { v } from 'convex/values';
import { internalMutation } from '../_generated/server';
import type { ActionCtx } from '../_generated/server';
import { internal } from '../_generated/api';
import { costOf } from '../pricing/prices';
import { sumOptional, type CapturedModelUsage } from './capture';

export type { CapturedModelUsage } from './capture';

/** The LLM operations we meter. Keep in sync with the schema `aiUsage.feature` union. */
export type Feature = 'ai_chat' | 'ai_chat_title' | 'support_chat';

const vFeature = v.union(
	v.literal('ai_chat'),
	v.literal('ai_chat_title'),
	v.literal('support_chat')
);

// Raw per-model usage as captured at the call site (cost not yet resolved).
// totalTokens is required: captureDirect normalizes a provider-omitted value
// to input + output once at capture time.
const vCapturedModel = v.object({
	model: v.string(),
	provider: v.optional(v.string()),
	inputTokens: v.number(),
	outputTokens: v.number(),
	totalTokens: v.number(),
	reasoningTokens: v.optional(v.number()),
	cachedInputTokens: v.optional(v.number()),
	nativeCostUsd: v.optional(v.number())
});

/**
 * Resolve cost + fold aggregates for one usage event and insert one `aiUsage`
 * row. Per model: native provider cost wins; otherwise the vendored price map
 * computes it; an unpriced model records 0 with costSource 'unknown'. The
 * aggregate costSource is the single per-model source when uniform, 'unknown'
 * if any model is unpriced, else 'mixed'.
 */
export const insert = internalMutation({
	args: {
		userId: v.optional(v.string()),
		feature: vFeature,
		threadId: v.optional(v.string()),
		status: v.optional(v.union(v.literal('ok'), v.literal('partial'), v.literal('error'))),
		models: v.array(vCapturedModel)
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const models = args.models.map((m) => {
			let costUsd: number;
			let costSource: 'native' | 'computed' | 'unknown';
			if (m.nativeCostUsd !== undefined) {
				costUsd = m.nativeCostUsd;
				costSource = 'native';
			} else {
				const computed = costOf(m.model, {
					input: m.inputTokens,
					output: m.outputTokens,
					reasoning: m.reasoningTokens,
					cachedInput: m.cachedInputTokens
				});
				if (computed === null) {
					costUsd = 0;
					costSource = 'unknown';
				} else {
					costUsd = computed;
					costSource = 'computed';
				}
			}
			return {
				model: m.model,
				...(m.provider !== undefined ? { provider: m.provider } : {}),
				inputTokens: m.inputTokens,
				outputTokens: m.outputTokens,
				totalTokens: m.totalTokens,
				...(m.reasoningTokens !== undefined ? { reasoningTokens: m.reasoningTokens } : {}),
				...(m.cachedInputTokens !== undefined ? { cachedInputTokens: m.cachedInputTokens } : {}),
				costUsd,
				costSource
			};
		});

		let inputTokens = 0;
		let outputTokens = 0;
		let totalTokens = 0;
		let costUsd = 0;
		let reasoningTokens: number | undefined;
		let cachedInputTokens: number | undefined;
		for (const m of models) {
			inputTokens += m.inputTokens;
			outputTokens += m.outputTokens;
			totalTokens += m.totalTokens;
			costUsd += m.costUsd;
			reasoningTokens = sumOptional(reasoningTokens, m.reasoningTokens);
			cachedInputTokens = sumOptional(cachedInputTokens, m.cachedInputTokens);
		}

		const sources = new Set(models.map((m) => m.costSource));
		const costSource: 'native' | 'computed' | 'mixed' | 'unknown' =
			sources.size === 1
				? sources.has('native')
					? 'native'
					: sources.has('computed')
						? 'computed'
						: 'unknown'
				: sources.has('unknown')
					? 'unknown'
					: 'mixed';

		await ctx.db.insert('aiUsage', {
			...(args.userId !== undefined ? { userId: args.userId } : {}),
			feature: args.feature,
			...(args.threadId !== undefined ? { threadId: args.threadId } : {}),
			status: args.status ?? 'ok',
			models,
			inputTokens,
			outputTokens,
			totalTokens,
			...(reasoningTokens !== undefined ? { reasoningTokens } : {}),
			...(cachedInputTokens !== undefined ? { cachedInputTokens } : {}),
			costUsd,
			costSource,
			at: Date.now()
		});
		return null;
	}
});

/**
 * Fire-and-forget recorder for action call sites. No-ops when nothing was used,
 * otherwise hands the captured per-model usage to the `record` mutation, which
 * resolves cost and persists the row.
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
		await ctx.runMutation(internal.aiUsage.record.insert, args);
	} catch (error) {
		// Metering must never fail the feature call that produced the usage:
		// callers invoke this after a successful stream/generation, so a
		// throwing insert would surface a metering problem as an LLM failure.
		console.error('[aiUsage] Failed to record usage', error);
	}
}
