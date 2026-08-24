import { v, type Infer } from 'convex/values';
import type { SupportedLocale } from '../i18n/translations';

export const founderIncidentSkipReasonValidator = v.union(
	v.literal('user_deleted'),
	v.literal('not_verified'),
	v.literal('test_email'),
	v.literal('founder_not_configured')
);

export const founderIncidentDeliveryStatusValidator = v.union(
	v.literal('waiting'),
	v.literal('queued'),
	v.literal('sent'),
	v.literal('delivery_delayed'),
	v.literal('delivered'),
	v.literal('bounced'),
	v.literal('failed'),
	v.literal('cancelled'),
	v.literal('unknown')
);

export const founderIncidentQueueResultValidator = v.union(
	v.object({ status: v.literal('enqueued') }),
	v.object({ status: v.literal('already_processed') }),
	v.object({
		status: v.literal('skipped'),
		reason: founderIncidentSkipReasonValidator
	})
);

export const founderIncidentEmailFields = {
	userId: v.string(),
	incident: v.string(),
	status: v.union(v.literal('enqueued'), v.literal('skipped')),
	emailId: v.optional(v.string()),
	skippedReason: v.optional(founderIncidentSkipReasonValidator),
	locale: v.optional(v.string()),
	deliveryStatus: v.optional(founderIncidentDeliveryStatusValidator),
	deliveryUpdatedAt: v.optional(v.number()),
	complainedAt: v.optional(v.number()),
	enqueuedAt: v.optional(v.number()),
	createdAt: v.number()
};

export type FounderIncidentSkipReason = Infer<typeof founderIncidentSkipReasonValidator>;
export type FounderIncidentDeliveryStatus = Infer<typeof founderIncidentDeliveryStatusValidator>;
export type FounderIncidentQueueResult = Infer<typeof founderIncidentQueueResultValidator>;

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
