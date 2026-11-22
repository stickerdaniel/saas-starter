import { Table } from '@confect/core';
import * as Schema from 'effect/Schema';

export default Table.make(() =>
	Schema.Struct({
		userId: Schema.optional(Schema.String),
		feature: Schema.Literals(['ai_chat', 'ai_chat_title', 'support_chat']),
		threadId: Schema.optional(Schema.String),
		status: Schema.Literals(['ok', 'partial', 'error']),
		models: Schema.Array(
			Schema.Struct({
				model: Schema.String,
				provider: Schema.optional(Schema.String),
				inputTokens: Schema.Number,
				outputTokens: Schema.Number,
				totalTokens: Schema.Number,
				reasoningTokens: Schema.optional(Schema.Number),
				cachedInputTokens: Schema.optional(Schema.Number),
				costUsd: Schema.Number,
				costSource: Schema.Literals(['native', 'computed', 'unknown'])
			})
		),
		inputTokens: Schema.Number,
		outputTokens: Schema.Number,
		totalTokens: Schema.Number,
		reasoningTokens: Schema.optional(Schema.Number),
		cachedInputTokens: Schema.optional(Schema.Number),
		costUsd: Schema.Number,
		costSource: Schema.Literals(['native', 'computed', 'mixed', 'unknown']),
		at: Schema.Number
	})
)
	.index('by_user_at', ['userId', 'at'])
	.index('by_feature_at', ['feature', 'at']);
