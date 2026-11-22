import { Table } from '@confect/core';
import * as Schema from 'effect/Schema';

export default Table.make(() =>
	Schema.Struct({
		key: Schema.String,
		value: Schema.String,
		updatedAt: Schema.Number,
		updatedBy: Schema.optional(Schema.String)
	})
).index('by_key', ['key']);
