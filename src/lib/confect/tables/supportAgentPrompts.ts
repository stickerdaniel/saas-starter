import { Table } from '@confect/core';
import * as Schema from 'effect/Schema';

export default Table.make(() =>
	Schema.Struct({
		systemPrompt: Schema.String,
		locale: Schema.optional(Schema.String),
		note: Schema.optional(Schema.String),
		active: Schema.Boolean,
		createdAt: Schema.Number
	})
).index('by_active', ['active']);
