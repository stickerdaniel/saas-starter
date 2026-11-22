import { Table } from '@confect/core';
import * as Schema from 'effect/Schema';

export default Table.make(() =>
	Schema.Struct({
		totalUsers: Schema.Number,
		adminCount: Schema.Number,
		bannedCount: Schema.Number,
		shard: Schema.optional(Schema.Number)
	})
).index('by_shard', ['shard']);
