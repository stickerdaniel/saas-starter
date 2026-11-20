import { Table } from '@confect/core';
import * as Schema from 'effect/Schema';

export default Table.make(() =>
	Schema.Struct({
		threadId: Schema.String,
		userId: Schema.String,
		createdAt: Schema.Number,
		isWarm: Schema.optional(Schema.Boolean),
		title: Schema.optional(Schema.String),
		lastMessage: Schema.optional(Schema.String),
		lastMessageAt: Schema.optional(Schema.Number),
		sidebarActivityAt: Schema.optional(Schema.Number)
	})
)
	.index('by_user', ['userId'])
	.index('by_thread', ['threadId'])
	.index('by_user_warm', ['userId', 'isWarm'])
	.index('by_userId_and_sidebarActivityAt', ['userId', 'sidebarActivityAt']);
