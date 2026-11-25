import { Table } from '@confect/core';
import * as Schema from 'effect/Schema';
import { MessageFields } from '../schemas/messages';

export default Table.make(() =>
	Schema.Struct({
		...MessageFields,
		quotaSettledAt: Schema.optional(Schema.Number)
	})
)
	.index('by_user', ['userId'])
	.index('by_user_and_settled', ['userId', 'quotaSettledAt']);
