import { Table } from '@confect/core';
import * as Schema from 'effect/Schema';
import { Id } from '../_generated/id';

export default Table.make(() =>
	Schema.Struct({
		version: Schema.Literal(1),
		status: Schema.Literals(['running', 'complete']),
		cursor: Schema.NullOr(Schema.String),
		processed: Schema.Number,
		scheduledFnId: Schema.optional(Id('_scheduled_functions'))
	})
);
