import * as Schema from 'effect/Schema';
import { EmailEvent, EmailId } from '../schemas/resend';
import type { SupportedLocale } from '../i18n/translations';

export const FounderIncidentSkipReasonSchema = Schema.Literals([
	'user_deleted',
	'not_verified',
	'test_email',
	'founder_not_configured'
]);

export const FounderIncidentDeliveryStatusSchema = Schema.Literals([
	'waiting',
	'queued',
	'sent',
	'delivery_delayed',
	'delivered',
	'bounced',
	'failed',
	'cancelled',
	'unknown'
]);

const FounderIncidentSkippedSchema = Schema.Struct({
	status: Schema.Literal('skipped'),
	reason: FounderIncidentSkipReasonSchema
});

export const FounderIncidentQueueResultSchema = Schema.Union([
	Schema.Struct({ status: Schema.Literal('enqueued') }),
	Schema.Struct({ status: Schema.Literal('already_processed') }),
	FounderIncidentSkippedSchema
]);

export const FounderIncidentTemplateSchema = Schema.Struct({
	locale: Schema.String,
	subject: Schema.String,
	text: Schema.String
});

const FounderIncidentEnvelopeSchema = Schema.Struct({
	from: Schema.String,
	to: Schema.String,
	replyTo: Schema.optional(Schema.mutable(Schema.Array(Schema.String))),
	headers: Schema.mutable(
		Schema.Array(Schema.Struct({ name: Schema.String, value: Schema.String }))
	),
	subject: Schema.String,
	text: Schema.String
});

export const FounderIncidentPreviewSchema = Schema.Union([
	Schema.Struct({
		status: Schema.Literal('ready'),
		incident: Schema.String,
		userId: Schema.String,
		revision: Schema.Number,
		locale: Schema.String,
		envelope: FounderIncidentEnvelopeSchema,
		approvalDigest: Schema.String
	}),
	FounderIncidentSkippedSchema
]);

export const FounderIncidentRecipientArgsSchema = Schema.Struct({
	userId: Schema.String,
	incident: Schema.String
});

export const SaveDraftArgsSchema = Schema.Struct({
	incident: Schema.String,
	expectedRevision: Schema.Union([Schema.Null, Schema.Number]),
	templates: Schema.Array(FounderIncidentTemplateSchema)
});

export const DraftRevisionSchema = Schema.Struct({ revision: Schema.Number });

export const PreviewDraftArgsSchema = Schema.Struct({
	incident: Schema.String,
	userId: Schema.String
});

export const QueueDraftArgsSchema = Schema.Struct({
	incident: Schema.String,
	userId: Schema.String,
	approvalDigest: Schema.String
});

export const FounderIncidentReconciliationSchema = Schema.Union([
	Schema.Struct({ status: Schema.Literal('not_found') }),
	Schema.Struct({ status: Schema.Literal('skipped') }),
	Schema.Struct({
		status: Schema.Literal('reconciled'),
		deliveryStatus: FounderIncidentDeliveryStatusSchema,
		complained: Schema.Boolean
	})
]);

export const EmailEventArgsSchema = Schema.Struct({ id: EmailId, event: EmailEvent });

export type FounderIncidentTemplate = typeof FounderIncidentTemplateSchema.Type;
export type FounderIncidentEnvelope = typeof FounderIncidentEnvelopeSchema.Type;
export type FounderIncidentSkipped = typeof FounderIncidentSkippedSchema.Type;
export type FounderIncidentSkipReason = typeof FounderIncidentSkipReasonSchema.Type;
export type FounderIncidentDeliveryStatus = typeof FounderIncidentDeliveryStatusSchema.Type;
export type FounderIncidentQueueResult = typeof FounderIncidentQueueResultSchema.Type;

export type FounderIncidentContact = {
	name: string;
	replyTo?: string;
};

export type FounderIncidentRenderInput = {
	locale: SupportedLocale;
	recipientName?: string;
	senderName: string;
};

export type FounderIncidentRenderedEmail = {
	subject: string;
	text: string;
};

export type FounderIncidentRenderer = (
	input: FounderIncidentRenderInput
) => FounderIncidentRenderedEmail;

export type FounderIncidentRegistry = Readonly<Record<string, FounderIncidentRenderer>>;

/** Retain literal incident keys while checking every entry against the renderer contract. */
export function defineFounderIncidentRegistry<const Registry extends FounderIncidentRegistry>(
	registry: Registry
): Registry {
	return registry;
}
