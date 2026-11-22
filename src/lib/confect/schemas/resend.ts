import type { EmailId as ResendEmailId } from '@convex-dev/resend';
import * as Schema from 'effect/Schema';

export const EmailId = Schema.String.pipe(
	Schema.refine((_value: string): _value is ResendEmailId => true),
	Schema.toType
);

const OneOrMany = Schema.Union([Schema.String, Schema.Array(Schema.String)]);
const NameValue = Schema.Struct({ name: Schema.String, value: Schema.String });

const commonFields = {
	broadcast_id: Schema.optional(Schema.String),
	created_at: Schema.String,
	email_id: Schema.String,
	from: OneOrMany,
	to: OneOrMany,
	cc: Schema.optional(OneOrMany),
	bcc: Schema.optional(OneOrMany),
	reply_to: Schema.optional(OneOrMany),
	message_id: Schema.optional(Schema.String),
	headers: Schema.optional(Schema.Array(NameValue)),
	subject: Schema.String,
	tags: Schema.optional(
		Schema.Union([Schema.Record(Schema.String, Schema.String), Schema.Array(NameValue)])
	)
};

const event = <const Type extends string, Data extends Schema.Struct.Fields>(
	type: Type,
	data: Data
) =>
	Schema.Struct({
		type: Schema.Literal(type),
		created_at: Schema.String,
		data: Schema.Struct({ ...commonFields, ...data })
	});

export const EmailEvent = Schema.Union([
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
