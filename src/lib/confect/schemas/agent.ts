import * as Schema from 'effect/Schema';

export const StreamArgs = Schema.UndefinedOr(
	Schema.Union([
		Schema.Struct({ kind: Schema.Literal('list'), startOrder: Schema.optional(Schema.Number) }),
		Schema.Struct({
			kind: Schema.Literal('deltas'),
			cursors: Schema.Array(Schema.Struct({ streamId: Schema.String, cursor: Schema.Number }))
		})
	])
);
