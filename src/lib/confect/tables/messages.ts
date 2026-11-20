import { Table } from '@confect/core';
import * as Schema from 'effect/Schema';

export default Table.make(() =>
	Schema.Struct({
		userId: Schema.String,
		body: Schema.String,
		quotaSettledAt: Schema.optional(Schema.Number)
	})
)
	.index('by_user', ['userId'])
	.index('by_user_and_settled', ['userId', 'quotaSettledAt']);
