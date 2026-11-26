import { Table } from '@confect/core';
import * as Schema from 'effect/Schema';

export default Table.make(() =>
	Schema.Struct({
		userId: Schema.String,
		epoch: Schema.Number
	})
).index('by_userId', ['userId']);
