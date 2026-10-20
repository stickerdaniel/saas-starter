import { ConvexError, v } from 'convex/values';
import { components } from '../_generated/api';
import { internalMutation, type MutationCtx, type QueryCtx } from '../_generated/server';
import { getValidLocale, type SupportedLocale } from '../i18n/translations';
import { isTestEmail } from './helpers';
import { assertResendApiKey, resend } from './resend';
import {
	founderIncidentQueueResultValidator,
	type FounderIncidentContact,
	type FounderIncidentEnvelope,
	type FounderIncidentRegistry,
	type FounderIncidentRenderer,
	type FounderIncidentSkipped
} from './founderIncidentTypes';

type FounderIncidentMutationOptions<Registry extends FounderIncidentRegistry> = {
	registry: Registry;
	resolveContact: (ctx: QueryCtx) => Promise<FounderIncidentContact | null>;
};

type PreparedFounderIncident = {
	status: 'ready';
	locale: SupportedLocale;
	envelope: FounderIncidentEnvelope;
};

function validateRenderedEmail(subject: string, text: string): { subject: string; text: string } {
	const normalizedSubject = subject.trim();
	const normalizedText = text.trim();
	if (!normalizedSubject || /[\r\n]/.test(normalizedSubject) || !normalizedText) {
		throw new ConvexError('Invalid founder incident email content');
	}
	return { subject: normalizedSubject, text: normalizedText };
}

export async function findFounderIncidentEmail(ctx: QueryCtx, incident: string, userId: string) {
	return await ctx.db
		.query('founderIncidentEmails')
		.withIndex('by_incident_and_user', (q) => q.eq('incident', incident).eq('userId', userId))
		.unique();
}

/** Resolve eligibility and normalize once, before previewing or enqueueing. */
export async function prepareFounderIncidentEmail(
	ctx: QueryCtx,
	userId: string,
	render: FounderIncidentRenderer,
	resolveContact: (ctx: QueryCtx) => Promise<FounderIncidentContact | null>
): Promise<PreparedFounderIncident | FounderIncidentSkipped> {
	const user = await ctx.runQuery(components.betterAuth.adapter.findOne, {
		model: 'user',
		where: [{ field: '_id', operator: 'eq', value: userId }]
	});
	if (!user) return { status: 'skipped', reason: 'user_deleted' };

	const { email, emailVerified, locale, name } = user as {
		email: string;
		emailVerified?: boolean;
		locale?: string | null;
		name?: string;
	};
	if (!emailVerified) return { status: 'skipped', reason: 'not_verified' };
	if (isTestEmail(email)) return { status: 'skipped', reason: 'test_email' };

	const contact = await resolveContact(ctx);
	if (!contact) return { status: 'skipped', reason: 'founder_not_configured' };

	const effectiveLocale = getValidLocale(locale);
	const rendered = render({
		locale: effectiveLocale,
		recipientName: name,
		senderName: contact.name
	});
	const { subject, text } = validateRenderedEmail(rendered.subject, rendered.text);
	const emailConfiguration = assertResendApiKey();
	return {
		status: 'ready',
		locale: effectiveLocale,
		envelope: {
			from: `${contact.name} <${emailConfiguration.sender}>`,
			replyTo: contact.replyTo ? [contact.replyTo] : undefined,
			to: email,
			subject,
			text,
			headers: [
				{ name: 'X-Email-Category', value: 'incident' },
				{ name: 'X-Email-Template', value: 'founder-incident' }
			]
		}
	};
}

/** Component work and the application ledger commit or roll back together. */
export async function enqueueFounderIncidentEmail(
	ctx: MutationCtx,
	incident: string,
	userId: string,
	{ locale, envelope }: Pick<PreparedFounderIncident, 'locale' | 'envelope'>
) {
	const now = Date.now();
	const emailId = await resend.sendEmail(ctx, envelope);
	await ctx.db.insert('founderIncidentEmails', {
		userId,
		incident,
		status: 'enqueued',
		emailId,
		locale,
		deliveryStatus: 'waiting',
		deliveryUpdatedAt: now,
		enqueuedAt: now,
		createdAt: now
	});
	return { status: 'enqueued' as const };
}

/** Legacy registry sender: eligibility skips remain terminal ledger outcomes. */
export function createFounderIncidentEmailMutation<Registry extends FounderIncidentRegistry>({
	registry,
	resolveContact
}: FounderIncidentMutationOptions<Registry>) {
	return internalMutation({
		args: { userId: v.string(), incident: v.string() },
		returns: founderIncidentQueueResultValidator,
		handler: async (ctx, { userId, incident }) => {
			const render = Object.prototype.hasOwnProperty.call(registry, incident)
				? registry[incident]
				: undefined;
			if (!render) throw new ConvexError('Unknown founder incident key');
			if (await findFounderIncidentEmail(ctx, incident, userId)) {
				return { status: 'already_processed' as const };
			}

			const prepared = await prepareFounderIncidentEmail(ctx, userId, render, resolveContact);
			if (prepared.status === 'skipped') {
				await ctx.db.insert('founderIncidentEmails', {
					userId,
					incident,
					status: 'skipped',
					skippedReason: prepared.reason,
					createdAt: Date.now()
				});
				return prepared;
			}
			return await enqueueFounderIncidentEmail(ctx, incident, userId, prepared);
		}
	});
}
