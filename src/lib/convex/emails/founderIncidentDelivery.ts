import type { EmailEvent, EmailId } from '@convex-dev/resend';
import { v } from 'convex/values';
import { internalMutation, type MutationCtx } from '../_generated/server';
import { resend } from './resend';
import {
	founderIncidentDeliveryStatusValidator,
	type FounderIncidentDeliveryStatus
} from './founderIncidentTypes';

const deliveryRank: Record<Exclude<FounderIncidentDeliveryStatus, 'unknown'>, number> = {
	waiting: 0,
	queued: 1,
	sent: 2,
	delivery_delayed: 3,
	delivered: 4,
	bounced: 5,
	failed: 5,
	cancelled: 100
};

const terminalDeliveryStatuses = new Set<FounderIncidentDeliveryStatus>([
	'delivered',
	'bounced',
	'failed',
	'cancelled'
]);

export function mergeFounderIncidentDeliveryStatus(
	current: FounderIncidentDeliveryStatus | undefined,
	next: FounderIncidentDeliveryStatus
): FounderIncidentDeliveryStatus {
	if (!current || current === 'unknown') return next;
	if (next === 'unknown' || current === 'cancelled') return current;
	return deliveryRank[next] > deliveryRank[current] ? next : current;
}

function deliveryStatusForEvent(event: EmailEvent): FounderIncidentDeliveryStatus | null {
	switch (event.type) {
		case 'email.sent':
			return 'sent';
		case 'email.delivery_delayed':
			return 'delivery_delayed';
		case 'email.delivered':
			return 'delivered';
		case 'email.bounced':
			return 'bounced';
		case 'email.failed':
			return 'failed';
		case 'email.complained':
		case 'email.opened':
		case 'email.clicked':
			return null;
	}
}

function eventTimestamp(event: EmailEvent): number {
	const timestamp = Date.parse(event.created_at);
	return Number.isFinite(timestamp) ? timestamp : Date.now();
}

/** Apply a component webhook callback to the matching persistent incident row. */
export async function applyFounderIncidentEmailEvent(
	ctx: MutationCtx,
	{ id, event }: { id: EmailId; event: EmailEvent }
): Promise<void> {
	const incidentEmail = await ctx.db
		.query('founderIncidentEmails')
		.withIndex('by_email_id', (q) => q.eq('emailId', id))
		.unique();
	if (!incidentEmail) return;

	const timestamp = eventTimestamp(event);
	if (event.type === 'email.complained') {
		if (!incidentEmail.complainedAt) {
			await ctx.db.patch(incidentEmail._id, { complainedAt: timestamp });
		}
		return;
	}

	const observedStatus = deliveryStatusForEvent(event);
	if (!observedStatus) return;
	const deliveryStatus = mergeFounderIncidentDeliveryStatus(
		incidentEmail.deliveryStatus,
		observedStatus
	);
	if (deliveryStatus === incidentEmail.deliveryStatus) return;

	await ctx.db.patch(incidentEmail._id, {
		deliveryStatus,
		deliveryUpdatedAt: timestamp
	});
}

const reconciliationResultValidator = v.union(
	v.object({ status: v.literal('not_found') }),
	v.object({ status: v.literal('skipped') }),
	v.object({
		status: v.literal('reconciled'),
		deliveryStatus: founderIncidentDeliveryStatusValidator,
		complained: v.boolean()
	})
);

/** Refresh one incident row from the Resend component's retained delivery state. */
export const reconcileFounderIncidentEmailDelivery = internalMutation({
	args: {
		userId: v.string(),
		incident: v.string()
	},
	returns: reconciliationResultValidator,
	handler: async (ctx, { userId, incident }) => {
		const incidentEmail = await ctx.db
			.query('founderIncidentEmails')
			.withIndex('by_incident_and_user', (q) => q.eq('incident', incident).eq('userId', userId))
			.unique();
		if (!incidentEmail) return { status: 'not_found' as const };
		if (incidentEmail.status === 'skipped') return { status: 'skipped' as const };

		const snapshot = incidentEmail.emailId
			? await resend.status(ctx, incidentEmail.emailId as EmailId)
			: null;
		const complained = Boolean(incidentEmail.complainedAt || snapshot?.complained);
		const now = Date.now();

		if (!snapshot && terminalDeliveryStatuses.has(incidentEmail.deliveryStatus ?? 'unknown')) {
			return {
				status: 'reconciled' as const,
				deliveryStatus: incidentEmail.deliveryStatus as FounderIncidentDeliveryStatus,
				complained
			};
		}

		const deliveryStatus = snapshot
			? mergeFounderIncidentDeliveryStatus(incidentEmail.deliveryStatus, snapshot.status)
			: 'unknown';
		await ctx.db.patch(incidentEmail._id, {
			deliveryStatus,
			deliveryUpdatedAt: now,
			...(!incidentEmail.complainedAt && snapshot?.complained ? { complainedAt: now } : {})
		});

		return { status: 'reconciled' as const, deliveryStatus, complained };
	}
});
