import { Table } from '@confect/core';
import * as Schema from 'effect/Schema';

export default Table.make(() =>
	Schema.Struct({
		threadId: Schema.String,
		messageId: Schema.String,
		pageUrl: Schema.optional(Schema.String),
		appVersion: Schema.optional(Schema.String),
		createdAt: Schema.Number
	})
).index('by_thread', ['threadId']);
