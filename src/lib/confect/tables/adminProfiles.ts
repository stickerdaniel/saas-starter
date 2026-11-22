import { Table } from '@confect/core';
import * as Schema from 'effect/Schema';

export default Table.make(() =>
	Schema.Struct({
		userId: Schema.String,
		founderWelcomeName: Schema.optional(Schema.String),
		founderWelcomeTitle: Schema.optional(Schema.String),
		founderWelcomeReplyTo: Schema.optional(Schema.String)
	})
).index('by_user', ['userId']);
