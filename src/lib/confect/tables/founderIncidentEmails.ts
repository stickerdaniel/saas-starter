import { Table } from '@confect/core';
import * as Schema from 'effect/Schema';

export default Table.make(() =>
	Schema.Struct({
		userId: Schema.String,
		incident: Schema.String,
		status: Schema.Literals(['enqueued', 'skipped']),
		emailId: Schema.optional(Schema.String),
		skippedReason: Schema.optional(
			Schema.Literals(['user_deleted', 'not_verified', 'test_email', 'founder_not_configured'])
		),
		locale: Schema.optional(Schema.String),
		deliveryStatus: Schema.optional(
			Schema.Literals([
				'waiting',
				'queued',
				'sent',
				'delivery_delayed',
				'delivered',
				'bounced',
				'failed',
				'cancelled',
				'unknown'
			])
		),
		deliveryUpdatedAt: Schema.optional(Schema.Number),
		complainedAt: Schema.optional(Schema.Number),
		enqueuedAt: Schema.optional(Schema.Number),
		createdAt: Schema.Number
	})
)
	.index('by_incident_and_user', ['incident', 'userId'])
	.index('by_email_id', ['emailId']);
