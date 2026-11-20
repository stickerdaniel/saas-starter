import { Table } from '@confect/core';
import * as Schema from 'effect/Schema';

export default Table.make(() =>
	Schema.Struct({
		email: Schema.String,
		userId: Schema.optional(Schema.String),
		isAdminUser: Schema.Boolean,
		notifyNewSupportTickets: Schema.Boolean,
		notifyUserReplies: Schema.Boolean,
		notifyNewSignups: Schema.Boolean,
		notifyNewCustomers: Schema.optional(Schema.Boolean),
		notifyCancellations: Schema.optional(Schema.Boolean),
		createdAt: Schema.Number,
		updatedAt: Schema.Number
	})
)
	.index('by_email', ['email'])
	.index('by_user', ['userId']);
