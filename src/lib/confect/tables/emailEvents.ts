import { Table } from '@confect/core';
import * as Schema from 'effect/Schema';

const stringOrStrings = Schema.Union([Schema.String, Schema.Array(Schema.String)]);
const header = Schema.Struct({ name: Schema.String, value: Schema.String });

const commonFields = {
	broadcast_id: Schema.optional(Schema.String),
	created_at: Schema.String,
	email_id: Schema.String,
	from: stringOrStrings,
	to: stringOrStrings,
	cc: Schema.optional(stringOrStrings),
	bcc: Schema.optional(stringOrStrings),
	reply_to: Schema.optional(stringOrStrings),
	message_id: Schema.optional(Schema.String),
	headers: Schema.optional(Schema.Array(header)),
	subject: Schema.String,
	tags: Schema.optional(
		Schema.Union([Schema.Record(Schema.String, Schema.String), Schema.Array(header)])
	)
};

const event = <const Type extends string, const Data extends Schema.Struct.Fields>(
	type: Type,
	data: Data
) =>
	Schema.Struct({
		type: Schema.Literal(type),
		created_at: Schema.String,
		data: Schema.Struct({ ...commonFields, ...data })
	});

const emailEvent = Schema.Union([
	event('email.sent', {}),
	event('email.delivered', {}),
	event('email.delivery_delayed', {}),
	event('email.complained', {}),
	event('email.bounced', {
		bounce: Schema.Struct({ message: Schema.String, subType: Schema.String, type: Schema.String })
	}),
	event('email.opened', {
		open: Schema.Struct({
			ipAddress: Schema.String,
			timestamp: Schema.String,
			userAgent: Schema.String
		})
	}),
	event('email.clicked', {
		click: Schema.Struct({
			ipAddress: Schema.String,
			link: Schema.String,
			timestamp: Schema.String,
			userAgent: Schema.String
		})
	}),
	event('email.failed', { failed: Schema.Struct({ reason: Schema.String }) })
]);

export default Table.make(() =>
	Schema.Struct({
		emailId: Schema.String,
		eventType: Schema.String,
		timestamp: Schema.Number,
		data: emailEvent
	})
).index('by_email_id', ['emailId']);
