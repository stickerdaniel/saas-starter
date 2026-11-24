import * as Schema from 'effect/Schema';

export const JourneyEpisodeSchema = Schema.Literals(['new_customer', 'cancellation']);

export const JourneyRequestFields = {
	episode: JourneyEpisodeSchema,
	userId: Schema.String,
	signupAt: Schema.Number,
	paymentAt: Schema.Number,
	window: Schema.Struct({ start: Schema.Number, end: Schema.Number })
};

export const JourneyRequestSchema = Schema.Struct(JourneyRequestFields);

export const CoverageSchema = Schema.Struct({
	truncated: Schema.Boolean,
	capture: Schema.optional(
		Schema.Union([
			Schema.Struct({ kind: Schema.Literal('started'), at: Schema.Number }),
			Schema.Struct({ kind: Schema.Literal('not_started') })
		])
	)
});

export const PartitionCountSchema = Schema.Struct({
	count: Schema.Number,
	firstAt: Schema.Union([Schema.Number, Schema.Null]),
	lastAt: Schema.Union([Schema.Number, Schema.Null]),
	truncated: Schema.Boolean
});

export const PartitionedFactsSchema = Schema.Struct({
	coverage: CoverageSchema,
	before: Schema.Union([PartitionCountSchema, Schema.Null]),
	after: Schema.Union([PartitionCountSchema, Schema.Null])
});

export const SupportFactsSchema = Schema.Struct({
	coverage: CoverageSchema,
	contacts: Schema.Array(Schema.Number)
});

export const ErasureStepSchema = Schema.Literals(['ledger', 'receipts', 'community', 'support']);

const continuationFields = {
	step: ErasureStepSchema,
	cursor: Schema.optional(Schema.String)
};

export const ContinuationSchema = Schema.Struct(continuationFields);

const erasurePageArgsFields = { userId: Schema.String, ...continuationFields };

export const ErasurePageArgsSchema = Schema.Struct(erasurePageArgsFields);

export const ErasureRunSchema = Schema.Struct({ ...erasurePageArgsFields, attempt: Schema.Number });
