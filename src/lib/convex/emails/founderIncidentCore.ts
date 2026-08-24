import { ConvexError, v } from 'convex/values';
import { components } from '../_generated/api';
import { internalMutation, type MutationCtx } from '../_generated/server';
import { requireEnv } from '../env';
import { getValidLocale } from '../i18n/translations';
import { isTestEmail } from './helpers';
import { assertResendApiKey, resend } from './resend';
import {
	founderIncidentQueueResultValidator,
	type FounderIncidentContact,
	type FounderIncidentRegistry,
	type FounderIncidentSkipReason
} from './founderIncidentTypes';

type FounderIncidentMutationOptions<Registry extends FounderIncidentRegistry> = {
	registry: Registry;
	resolveContact: (ctx: MutationCtx) => Promise<FounderIncidentContact | null>;
};

function validateRenderedEmail(subject: string, text: string): { subject: string; text: string } {
	const normalizedSubject = subject.trim();
	const normalizedText = text.trim();
	if (!normalizedSubject || /[\r\n]/.test(normalizedSubject) || !normalizedText) {
		throw new ConvexError('Invalid founder incident email content');
	}
	return { subject: normalizedSubject, text: normalizedText };
}

/**
 * Build an internal, single-recipient incident sender around an application-owned registry.
 * Registry membership, eligibility, enqueue, and audit commit in one mutation.
 */
export function createFounderIncidentEmailMutation<Registry extends FounderIncidentRegistry>({
	registry,
	resolveContact
}: FounderIncidentMutationOptions<Registry>) {
	return internalMutation({
		args: {
			userId: v.string(),
			incident: v.string()
		},
		returns: founderIncidentQueueResultValidator,
		handler: async (ctx, { userId, incident }) => {
			const render = Object.prototype.hasOwnProperty.call(registry, incident)
				? registry[incident]
				: undefined;
			if (!render) throw new ConvexError('Unknown founder incident key');

			const existing = await ctx.db
				.query('founderIncidentEmails')
				.withIndex('by_incident_and_user', (q) => q.eq('incident', incident).eq('userId', userId))
				.unique();
			if (existing) return { status: 'already_processed' as const };

			const user = await ctx.runQuery(components.betterAuth.adapter.findOne, {
				model: 'user',
				where: [{ field: '_id', operator: 'eq', value: userId }]
			});
			const now = Date.now();
			const skip = async (reason: FounderIncidentSkipReason) => {
				await ctx.db.insert('founderIncidentEmails', {
					userId,
					incident,
					status: 'skipped',
					skippedReason: reason,
					createdAt: now
				});
				return { status: 'skipped' as const, reason };
			};

			if (!user) return await skip('user_deleted');

			const { email, emailVerified, locale, name } = user as {
				email: string;
				emailVerified?: boolean;
				locale?: string | null;
				name?: string;
			};
			if (!emailVerified) return await skip('not_verified');
			if (isTestEmail(email)) return await skip('test_email');

			const contact = await resolveContact(ctx);
			if (!contact) return await skip('founder_not_configured');

			const effectiveLocale = getValidLocale(locale);
			const rendered = render({
				locale: effectiveLocale,
				recipientName: name,
				senderName: contact.name
			});
			const { subject, text } = validateRenderedEmail(rendered.subject, rendered.text);

			assertResendApiKey();
			const emailId = await resend.sendEmail(ctx, {
				from: `${contact.name} <${requireEnv('AUTH_EMAIL', { feature: 'email delivery' })}>`,
				replyTo: contact.replyTo ? [contact.replyTo] : undefined,
				to: email,
				subject,
				text,
				headers: [
					{ name: 'X-Email-Category', value: 'incident' },
					{ name: 'X-Email-Template', value: 'founder-incident' }
				]
			});

			await ctx.db.insert('founderIncidentEmails', {
				userId,
				incident,
				status: 'enqueued',
				emailId,
				locale: effectiveLocale,
				deliveryStatus: 'waiting',
				deliveryUpdatedAt: now,
				enqueuedAt: now,
				createdAt: now
			});
			return { status: 'enqueued' as const };
		}
	});
}
