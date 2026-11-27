import { Table } from '@confect/core';
import * as Schema from 'effect/Schema';

export default Table.make(() =>
	Schema.Struct({
		userId: Schema.String,
		clientId: Schema.String,
		grant: Schema.String,
		lastUsedAt: Schema.Number
	})
).index('by_userId_and_clientId', ['userId', 'clientId']);
