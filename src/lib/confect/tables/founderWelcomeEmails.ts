import { Table } from '@confect/core';
import * as Schema from 'effect/Schema';
import { Id } from '../_generated/id';

export default Table.make(() =>
	Schema.Struct({
		userId: Schema.String,
		signupEmail: Schema.String,
		delayMs: Schema.optional(Schema.Number),
		status: Schema.Literals(['pending_verification', 'scheduled', 'sent', 'skipped']),
		scheduledFnId: Schema.optional(Id('_scheduled_functions')),
		sentAt: Schema.optional(Schema.Number),
		emailId: Schema.optional(Schema.String),
		subject: Schema.optional(Schema.String),
		skippedReason: Schema.optional(Schema.String),
		createdAt: Schema.Number
	})
).index('by_user', ['userId']);
