import { FunctionImpl, GroupImpl } from '@confect/server';
import * as Duration from 'effect/Duration';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import refs from '../_generated/refs';
import databaseSchema from '../_generated/schema';
import { MutationCtx, Scheduler } from '../_generated/services';
import { costOf } from '../pricing/prices';
import { sumOptional } from './capture';
import record from './record.spec';
import type { CapturedModelSchema, UsageEventArgsSchema } from './schemas';

type CapturedModel = typeof CapturedModelSchema.Type;
type ModelCostSource = 'native' | 'computed' | 'unknown';

const priced = (model: CapturedModel): { costUsd: number; costSource: ModelCostSource } => {
	if (model.nativeCostUsd !== undefined) {
		return { costUsd: model.nativeCostUsd, costSource: 'native' };
	}
	const computed = costOf(model.model, {
		input: model.inputTokens,
		output: model.outputTokens,
		reasoning: model.reasoningTokens,
		cachedInput: model.cachedInputTokens
	});
	return computed === null
		? { costUsd: 0, costSource: 'unknown' }
		: { costUsd: computed, costSource: 'computed' };
};

const pricedModel = (model: CapturedModel) => ({
	model: model.model,
	...(model.provider !== undefined ? { provider: model.provider } : {}),
	inputTokens: model.inputTokens,
	outputTokens: model.outputTokens,
	totalTokens: model.totalTokens,
	...(model.reasoningTokens !== undefined ? { reasoningTokens: model.reasoningTokens } : {}),
	...(model.cachedInputTokens !== undefined ? { cachedInputTokens: model.cachedInputTokens } : {}),
	...priced(model)
});

const aggregateCostSource = (sources: ReadonlySet<ModelCostSource>): ModelCostSource | 'mixed' =>
	sources.size === 1
		? sources.has('native')
			? 'native'
			: sources.has('computed')
				? 'computed'
				: 'unknown'
		: sources.has('unknown')
			? 'unknown'
			: 'mixed';

const usageRow = (args: typeof UsageEventArgsSchema.Type, at: number) => {
	const models = args.models.map(pricedModel);
	let inputTokens = 0;
	let outputTokens = 0;
	let totalTokens = 0;
	let costUsd = 0;
	let reasoningTokens: number | undefined;
	let cachedInputTokens: number | undefined;
	for (const model of models) {
		inputTokens += model.inputTokens;
		outputTokens += model.outputTokens;
		totalTokens += model.totalTokens;
		costUsd += model.costUsd;
		reasoningTokens = sumOptional(reasoningTokens, model.reasoningTokens);
		cachedInputTokens = sumOptional(cachedInputTokens, model.cachedInputTokens);
	}
	return {
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
		costSource: aggregateCostSource(new Set(models.map((model) => model.costSource))),
		at
	};
};

export const recordAiUsage = (args: typeof UsageEventArgsSchema.Type) =>
	args.models.length === 0
		? Effect.void
		: Effect.gen(function* () {
				yield* (yield* Scheduler).runAfter(
					Duration.zero,
					refs.internal.aiUsage.record.insert,
					args
				);
			}).pipe(
				Effect.catchCause(() =>
					Effect.sync(() => {
						console.error({ code: 'ai_usage_record_failed', feature: args.feature });
					})
				)
			);

export default GroupImpl.make(databaseSchema, record).pipe(
	Layer.provide([
		FunctionImpl.make(databaseSchema, record, 'insert', (args) =>
			Effect.gen(function* () {
				const ctx = yield* MutationCtx;
				yield* Effect.promise(() => ctx.db.insert('aiUsage', usageRow(args, Date.now())));
				return null;
			})
		)
	]),
	GroupImpl.finalize
);
