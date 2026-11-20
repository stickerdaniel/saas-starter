import { Table } from '@confect/core';
import * as Schema from 'effect/Schema';
import { Id } from '../_generated/id';

export default Table.make(() =>
	Schema.Struct({
		userId: Schema.String,
		email: Schema.Literals(['feedback', 'cancellation']),
		dedupeKey: Schema.String,
		recipientEmail: Schema.String,
		status: Schema.Literals(['pending_verification', 'scheduled', 'sent', 'skipped']),
		skippedReason: Schema.optional(Schema.String),
		scheduledFnId: Schema.optional(Id('_scheduled_functions')),
		sentAt: Schema.optional(Schema.Number),
		emailId: Schema.optional(Schema.String),
		subject: Schema.optional(Schema.String),
		createdAt: Schema.Number
	})
).index('by_userId_and_email_and_dedupeKey', ['userId', 'email', 'dedupeKey']);
