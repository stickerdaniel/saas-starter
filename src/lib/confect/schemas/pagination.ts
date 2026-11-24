import * as Schema from 'effect/Schema';

export const PaginationOpts = Schema.Struct({
	numItems: Schema.Number,
	cursor: Schema.NullOr(Schema.String),
	endCursor: Schema.optional(Schema.NullOr(Schema.String)),
	id: Schema.optional(Schema.Number),
	maximumRowsRead: Schema.optional(Schema.Number),
	maximumBytesRead: Schema.optional(Schema.Number)
});
