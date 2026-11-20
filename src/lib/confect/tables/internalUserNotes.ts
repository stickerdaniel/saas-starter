import { Table } from '@confect/core';
import * as Schema from 'effect/Schema';

export default Table.make(() =>
	Schema.Struct({
		userId: Schema.String,
		adminUserId: Schema.String,
		content: Schema.String,
		createdAt: Schema.Number
	})
).index('by_user', ['userId']);
