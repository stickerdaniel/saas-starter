import { Table } from '@confect/core';
import * as Schema from 'effect/Schema';

export default Table.make(() =>
	Schema.Struct({
		source: Schema.String,
		startedAt: Schema.Number
	})
).index('by_source', ['source']);
