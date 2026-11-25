import * as Schema from 'effect/Schema';
import { Id } from '../_generated/id';

export const FounderFeedbackBillingSchema = Schema.Literals([
	'not_subscribed',
	'subscribed',
	'paid_before',
	'billing_unknown'
]);

export const FounderCancellationBillingSchema = Schema.Union([
	Schema.Struct({ cancellation: Schema.Literal('scheduled'), canceledAt: Schema.Number }),
	Schema.Struct({ cancellation: Schema.Literal('none') }),
	Schema.Struct({ cancellation: Schema.Literal('unknown') })
]);

export const FounderThreadSchema = Schema.Struct({
	inReplyTo: Schema.String,
	subject: Schema.String
});

const SendId = Id('founderEmailSends');

export const FounderEmailSendArgsSchema = Schema.Struct({ sendId: SendId });

export const FounderFeedbackSendArgsSchema = Schema.Struct({
	sendId: SendId,
	billing: Schema.optional(FounderFeedbackBillingSchema),
	thread: Schema.optional(FounderThreadSchema)
});

export const FounderCancellationSendArgsSchema = Schema.Struct({
	sendId: SendId,
	attempt: Schema.Number,
	billing: FounderCancellationBillingSchema
});

export const PersonalEmailSuppressionArgsSchema = Schema.Struct({
	userId: Schema.String,
	suppressed: Schema.Boolean
});

export const FounderFeedbackBillingArgsSchema = Schema.Struct({
	sendId: SendId,
	userId: Schema.String
});

export const FounderCancellationBillingArgsSchema = Schema.Struct({
	sendId: SendId,
	userId: Schema.String,
	attempt: Schema.Number
});

export const FounderWelcomeArgsSchema = Schema.Struct({ userId: Schema.String });

export const SentFounderWelcomeSchema = Schema.Union([
	Schema.Null,
	Schema.Struct({ emailId: Schema.String, subject: Schema.String })
]);

export type FounderFeedbackBilling = typeof FounderFeedbackBillingSchema.Type;
export type FounderCancellationBilling = typeof FounderCancellationBillingSchema.Type;
export type FounderThread = typeof FounderThreadSchema.Type;
