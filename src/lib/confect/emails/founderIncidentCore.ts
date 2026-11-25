import * as Effect from 'effect/Effect';
import { components, internal } from '../../convex/_generated/api';
import type { MutationCtx, QueryCtx } from '../../convex/_generated/server';
import type { FounderWelcomeConfig } from '../admin/founderWelcome/queries';
import { FounderIncidentRefusal } from '../errorCodecs';
import { getValidLocale, type SupportedLocale } from '../i18n/translations';
import { FOUNDER_INCIDENT_REFUSALS } from './founderIncidentErrors';
import { isTestEmail } from './helpers';
import { assertResendApiKey, resend } from './resend';
import type {
	FounderIncidentContact,
	FounderIncidentEnvelope,
	FounderIncidentQueueResult,
	FounderIncidentRegistry,
	FounderIncidentRenderer,
	FounderIncidentSkipped,
	FounderIncidentSkipReason
} from './founderIncidentTypes';

type ContactResolver = (ctx: QueryCtx) => Promise<FounderIncidentContact | null>;

type PreparedFounderIncident = {
	status: 'ready';
	locale: SupportedLocale;
	envelope: FounderIncidentEnvelope;
};

export const refuseFounderIncident = (
	reason: (typeof FOUNDER_INCIDENT_REFUSALS)[keyof typeof FOUNDER_INCIDENT_REFUSALS]
) => Effect.fail(new FounderIncidentRefusal({ reason }));

const skipped = (reason: FounderIncidentSkipReason): FounderIncidentSkipped => ({
	status: 'skipped',
	reason
});

function validateRenderedEmail(subject: string, text: string) {
	const normalizedSubject = subject.trim();
	const normalizedText = text.trim();
	return !normalizedSubject || /[\r\n]/.test(normalizedSubject) || !normalizedText
		? refuseFounderIncident(FOUNDER_INCIDENT_REFUSALS.invalidContent)
		: Effect.succeed({ subject: normalizedSubject, text: normalizedText });
}

export async function resolveFounderIncidentContact(
	ctx: QueryCtx
): Promise<FounderIncidentContact | null> {
	const config: FounderWelcomeConfig = await ctx.runQuery(
		internal.admin.founderWelcome.queries.getFounderWelcomeConfigInternal,
		{}
	);
	if (!config.enabled) return null;
	return { name: config.name, replyTo: config.replyTo };
}

export async function findFounderIncidentEmail(ctx: QueryCtx, incident: string, userId: string) {
	return await ctx.db
		.query('founderIncidentEmails')
		.withIndex('by_incident_and_user', (q) => q.eq('incident', incident).eq('userId', userId))
		.unique();
}

/** Resolve eligibility and normalize once, before previewing or enqueueing. */
export const prepareFounderIncidentEmail = (
	ctx: QueryCtx,
	userId: string,
	render: FounderIncidentRenderer,
	resolveContact: ContactResolver
): Effect.Effect<PreparedFounderIncident | FounderIncidentSkipped, FounderIncidentRefusal> =>
	Effect.gen(function* () {
		const user = yield* Effect.promise(() =>
			ctx.runQuery(components.betterAuth.adapter.findOne, {
				model: 'user',
				where: [{ field: '_id', operator: 'eq', value: userId }]
			})
		);
		if (!user) return skipped('user_deleted');

		const { email, emailVerified, locale, name } = user as {
			email: string;
			emailVerified?: boolean;
			locale?: string | null;
			name?: string;
		};
		if (!emailVerified) return skipped('not_verified');
		if (isTestEmail(email)) return skipped('test_email');

		const contact = yield* Effect.promise(() => resolveContact(ctx));
		if (!contact) return skipped('founder_not_configured');

		const effectiveLocale = getValidLocale(locale);
		const rendered = yield* Effect.sync(() =>
			render({ locale: effectiveLocale, recipientName: name, senderName: contact.name })
		);
		const { subject, text } = yield* validateRenderedEmail(rendered.subject, rendered.text);
		const emailConfiguration = yield* Effect.sync(() => assertResendApiKey());
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
	});

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
export const queueFounderIncidentEmail = (
	ctx: MutationCtx,
	registry: FounderIncidentRegistry,
	resolveContact: ContactResolver,
	{ userId, incident }: { userId: string; incident: string }
): Effect.Effect<FounderIncidentQueueResult, FounderIncidentRefusal> =>
	Effect.gen(function* () {
		const render = Object.prototype.hasOwnProperty.call(registry, incident)
			? registry[incident]
			: undefined;
		if (!render) return yield* refuseFounderIncident(FOUNDER_INCIDENT_REFUSALS.unknownKey);
		if (yield* Effect.promise(() => findFounderIncidentEmail(ctx, incident, userId))) {
			return { status: 'already_processed' };
		}

		const prepared = yield* prepareFounderIncidentEmail(ctx, userId, render, resolveContact);
		if (prepared.status === 'skipped') {
			yield* Effect.promise(() =>
				ctx.db.insert('founderIncidentEmails', {
					userId,
					incident,
					status: 'skipped',
					skippedReason: prepared.reason,
					createdAt: Date.now()
				})
			);
			return prepared;
		}
		return yield* Effect.promise(() =>
			enqueueFounderIncidentEmail(ctx, incident, userId, prepared)
		);
	});
