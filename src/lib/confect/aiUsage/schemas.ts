import * as Schema from 'effect/Schema';

export const AiUsageFeatureSchema = Schema.Literals(['ai_chat', 'ai_chat_title', 'support_chat']);

export const CapturedModelSchema = Schema.Struct({
	model: Schema.String,
	provider: Schema.optional(Schema.String),
	inputTokens: Schema.Number,
	outputTokens: Schema.Number,
	totalTokens: Schema.Number,
	reasoningTokens: Schema.optional(Schema.Number),
	cachedInputTokens: Schema.optional(Schema.Number),
	nativeCostUsd: Schema.optional(Schema.Number)
});

export const UsageEventArgsSchema = Schema.Struct({
	userId: Schema.optional(Schema.String),
	feature: AiUsageFeatureSchema,
	threadId: Schema.optional(Schema.String),
	status: Schema.optional(Schema.Literals(['ok', 'partial', 'error'])),
	models: Schema.mutable(Schema.Array(CapturedModelSchema))
});
