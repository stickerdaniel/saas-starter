import { Table } from '@confect/core';
import * as Schema from 'effect/Schema';
import { Id } from '../_generated/id';

export default Table.make(() =>
	Schema.Struct({
		threadId: Schema.String,
		isReopen: Schema.Boolean,
		notificationType: Schema.Literals(['newTickets', 'userReplies']),
		scheduledFor: Schema.Number,
		messageIds: Schema.Array(Schema.String),
		scheduledFnId: Schema.optional(Id('_scheduled_functions')),
		claimToken: Schema.optional(Schema.String),
		generation: Schema.optional(Schema.String),
		claimLeaseExpiresAt: Schema.optional(Schema.Number),
		recoveryFnId: Schema.optional(Id('_scheduled_functions')),
		retryCount: Schema.optional(Schema.Number),
		createdAt: Schema.Number
	})
).index('by_thread', ['threadId']);
