import { Table } from '@confect/core';
import * as Schema from 'effect/Schema';
import {
	FounderIncidentDeliveryStatusSchema,
	FounderIncidentSkipReasonSchema
} from '../emails/founderIncidentTypes';

export default Table.make(() =>
	Schema.Struct({
		userId: Schema.String,
		incident: Schema.String,
		status: Schema.Literals(['enqueued', 'skipped']),
		emailId: Schema.optional(Schema.String),
		skippedReason: Schema.optional(FounderIncidentSkipReasonSchema),
		locale: Schema.optional(Schema.String),
		deliveryStatus: Schema.optional(FounderIncidentDeliveryStatusSchema),
		deliveryUpdatedAt: Schema.optional(Schema.Number),
		complainedAt: Schema.optional(Schema.Number),
		enqueuedAt: Schema.optional(Schema.Number),
		createdAt: Schema.Number
	})
)
	.index('by_incident_and_user', ['incident', 'userId'])
	.index('by_email_id', ['emailId']);
