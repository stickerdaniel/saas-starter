import { FunctionImpl, GroupImpl } from '@confect/server';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import * as Option from 'effect/Option';
import * as Schema from 'effect/Schema';
import { components } from '../../../convex/_generated/api';
import type { Doc, Id } from '../../../convex/_generated/dataModel';
import { env, type MutationCtx as ConvexMutationCtx } from '../../../convex/_generated/server';
import refs from '../../_generated/refs';
import databaseSchema from '../../_generated/schema';
import { MutationCtx, MutationRunner, QueryRunner } from '../../_generated/services';
import { requireEnv } from '../../env';
import { isTestEmail } from '../../emails/helpers';
import { resend } from '../../emails/resend';
import { getLocaleForEmail, getReadyEmailConfiguration } from '../../emails/send';
import {
	renderCancellationAdminNotificationEmail,
	renderNewCustomerAdminNotificationEmail
} from '../../emails/templates';
import type {
	CancellationAdminNotificationEmailData,
	NewCustomerAdminNotificationEmailData
} from '../../../emails/templates/types';
import { collectJourney, presentJourney, type PresentedJourney } from '../journey/collect';
import { resolveTimeZone, type JourneyFormat } from '../journey/format';
import { JOURNEY_SOURCES } from '../journey/registry';
import type { NotificationType } from '../notificationPreferences/queries';
import { composeCancellation, composeNewCustomer, type ComposedJourney } from './compose';
import send from './send.spec';

/**
 * The admin customer emails: one scheduled run per ledger row, which
 * finishes the row exactly once. Both episodes share this flow and differ
 * only in their audience, template and composition.
 *
 * The journey is read once per row; everything after it runs per recipient,
 * because the email is presented in the recipient's locale. Each recipient's
 * enqueue is its own child transaction with write limits, receives only the
 * rendered email, and rolls back alone when it fails.
 *
 * Logs carry fixed codes and the ledger row id, never stored text, addresses
 * or errors, which may carry either.
 */

const KiB = 1024;
const MiB = 1024 * KiB;
const DAY = 24 * 60 * 60 * 1000;

/** Recipient discovery: up to 501 preference rows. */
const DISCOVERY_LIMITS = { documentsRead: 510, bytesRead: MiB };

/** One recipient's enqueue: the component's email and content records. */
const ENQUEUE_LIMITS = { documentsWritten: 10, bytesWritten: 256 * KiB };

/** The largest rendered email a recipient gets, in UTF-8 bytes. */
const MAX_PAYLOAD = { html: 128 * KiB, text: 32 * KiB };

/** The `X-Email-Template` header of each email. */
type EmailTemplate = 'new-customer' | 'cancellation';

type Notification = Doc<'customerNotifications'>;
type Outcome = Pick<
	Notification,
	| 'status'
	| 'skippedReason'
	| 'failedReason'
	| 'emailIds'
	| 'enqueuedCount'
	| 'failedCount'
	| 'audienceTruncated'
>;
type RenderedEmail = { subject: string; html: string; text: string };

/** What a sender knows when it builds one recipient's email. */
type RecipientInput = {
	row: Notification;
	presented: PresentedJourney;
	format: JourneyFormat;
	customer: { name: string; email: string };
	adminDashboardLink: string;
};

/**
 * One episode's email: the ledger rows it sends, the preference toggle that
 * picks its recipients, and how one recipient's email is built and rendered.
 * Rendering the data with `journey: null` gives the version without the
 * journey.
 */
type EpisodeEmail<Data extends { journey: ComposedJourney | null }> = {
	kind: Notification['kind'];
	audience: NotificationType;
	template: EmailTemplate;
	data(input: RecipientInput): Data;
	render(data: Data, locale: string): RenderedEmail;
};

const NEW_CUSTOMER_EMAIL: EpisodeEmail<NewCustomerAdminNotificationEmailData> = {
	kind: 'new_customer',
	audience: 'newCustomers',
	template: 'new-customer',
	data({ row, presented, format, customer, adminDashboardLink }) {
		const composed = composeNewCustomer({ billing: row.billing, presented, format });
		return {
			customer: customer.name || customer.email,
			customerEmail: customer.email,
			amount: composed.amount,
			previewText: composed.previewText,
			journey: composed.journey,
			timeZone: format.timeZone,
			adminDashboardLink
		};
	},
	render: renderNewCustomerAdminNotificationEmail
};

const CANCELLATION_EMAIL: EpisodeEmail<CancellationAdminNotificationEmailData> = {
	kind: 'cancellation',
	audience: 'cancellations',
	template: 'cancellation',
	data({ row, presented, format, customer, adminDashboardLink }) {
		const composed = composeCancellation({ billing: row.billing, presented, format });
		const { signupAt, window } = row.request;
		return {
			customer: customer.name || customer.email,
			customerEmail: customer.email,
			duration: composed.duration,
			previewText: composed.previewText,
			journey: composed.journey,
			timeZone: format.timeZone,
			// The frozen window, not today's policy, so the footer names what the journey covers.
			lookbackDays: window.start <= signupAt ? null : Math.round((window.end - window.start) / DAY),
			adminDashboardLink
		};
	},
	render: renderCancellationAdminNotificationEmail
};

const decodeCustomer = Schema.decodeUnknownOption(
	Schema.Struct({
		email: Schema.String,
		name: Schema.optional(Schema.NullOr(Schema.String))
	})
);

/** The live customer's name and email, or null once the account is gone. */
async function liveCustomer(ctx: ConvexMutationCtx, userId: string) {
	const row: unknown = await ctx.runQuery(components.betterAuth.adapter.findOne, {
		model: 'user',
		where: [{ field: '_id', operator: 'eq', value: userId }]
	});
	return decodeCustomer(row).pipe(
		Option.map((user) => ({ name: user.name?.trim() ?? '', email: user.email })),
		Option.getOrNull
	);
}

const utf8Bytes = (value: string) => new TextEncoder().encode(value).byteLength;

function withinPayload({ html, text }: RenderedEmail): boolean {
	return utf8Bytes(html) <= MAX_PAYLOAD.html && utf8Bytes(text) <= MAX_PAYLOAD.text;
}

/**
 * The email for one recipient, or null when even the version without the
 * journey is too large to hand to the component.
 */
function renderWithinPayload<Data extends { journey: ComposedJourney | null }>(
	episode: EpisodeEmail<Data>,
	data: Data,
	locale: string,
	notificationId: Id<'customerNotifications'>
): RenderedEmail | null {
	const full = episode.render(data, locale);
	if (withinPayload(full)) return full;
	console.warn({ code: 'journey_payload_oversize', notificationId });
	const fallback = episode.render({ ...data, journey: null }, locale);
	if (withinPayload(fallback)) return fallback;
	console.error({ code: 'email_payload_oversize', notificationId });
	return null;
}

const finish = (notificationId: Id<'customerNotifications'>, outcome: Outcome) =>
	MutationCtx.use((ctx) =>
		Effect.promise(() =>
			ctx.db.patch('customerNotifications', notificationId, { ...outcome, completedAt: Date.now() })
		)
	);

const log = (level: 'warn' | 'error', code: string, notificationId: Id<'customerNotifications'>) =>
	(level === 'warn' ? Effect.logWarning : Effect.logError)({ code, notificationId });

/** Send `episode`'s email for one ledger row; a row of another kind or already finished is left alone. */
const sendEpisode = <Data extends { journey: ComposedJourney | null }>(
	notificationId: Id<'customerNotifications'>,
	episode: EpisodeEmail<Data>
) =>
	Effect.gen(function* () {
		const ctx = yield* MutationCtx;
		const row = yield* Effect.promise(() => ctx.db.get('customerNotifications', notificationId));
		if (row?.status !== 'scheduled' || row.kind !== episode.kind) return;

		const customer = yield* Effect.promise(() => liveCustomer(ctx, row.userId));
		if (!customer)
			return yield* finish(row._id, { status: 'skipped', skippedReason: 'owner_deleted' });
		if (isTestEmail(customer.email)) {
			return yield* finish(row._id, { status: 'skipped', skippedReason: 'test_customer' });
		}
		if (!getReadyEmailConfiguration()) {
			return yield* finish(row._id, { status: 'skipped', skippedReason: 'email_unavailable' });
		}

		const queries = yield* QueryRunner;
		const audience = yield* queries
			.runQuery(
				refs.internal.admin.notificationPreferences.queries.getJourneyRecipients,
				{ type: episode.audience },
				{ transactionLimits: DISCOVERY_LIMITS }
			)
			.pipe(Effect.catchCause(() => Effect.succeed(null)));
		if (audience === null) {
			yield* log('error', 'audience_unavailable', notificationId);
			return yield* finish(row._id, { status: 'failed', failedReason: 'audience_unavailable' });
		}
		const audienceTruncated = audience.truncated ? true : undefined;
		if (audienceTruncated) yield* log('warn', 'audience_truncated', notificationId);
		if (audience.emails.length === 0) {
			return yield* finish(row._id, {
				status: 'skipped',
				skippedReason: audienceTruncated ? 'audience_incomplete' : 'no_recipients',
				audienceTruncated
			});
		}

		const collected = yield* Effect.promise(() =>
			collectJourney(ctx, JOURNEY_SOURCES, row.request)
		);
		const timeZone = resolveTimeZone(env.ADMIN_TIME_ZONE);
		const siteUrl = requireEnv('SITE_URL', { feature: 'email deep links' }).replace(/\/+$/, '');
		const adminDashboardLink = `${siteUrl}/admin/users?search=${encodeURIComponent(customer.email)}`;
		const mutations = yield* MutationRunner;

		const emailIds: string[] = [];
		let failedCount = 0;
		for (const to of audience.emails) {
			const enqueued = yield* Effect.gen(function* () {
				const locale = yield* Effect.promise(() => getLocaleForEmail(ctx, to));
				const format = { locale, timeZone };
				const data = episode.data({
					row,
					presented: presentJourney(collected, format),
					format,
					customer,
					adminDashboardLink
				});
				const email = renderWithinPayload(episode, data, locale, notificationId);
				if (!email) return null;
				return yield* mutations.runMutation(
					refs.internal.admin.customerNotifications.send.enqueueRecipient,
					{ to, ...email, template: episode.template },
					{ transactionLimits: ENQUEUE_LIMITS }
				);
			}).pipe(
				Effect.catchCause(() =>
					log('error', 'email_enqueue_failed', notificationId).pipe(Effect.as(null))
				)
			);
			if (enqueued === null) failedCount++;
			else emailIds.push(enqueued);
		}

		yield* finish(row._id, {
			status: emailIds.length > 0 ? 'enqueued' : 'failed',
			emailIds,
			enqueuedCount: emailIds.length,
			failedCount,
			audienceTruncated
		});
	});

export default GroupImpl.make(databaseSchema, send).pipe(
	Layer.provide([
		FunctionImpl.make(
			databaseSchema,
			send,
			'enqueueRecipient',
			({ to, subject, html, text, template }) =>
				Effect.gen(function* () {
					const emailConfiguration = getReadyEmailConfiguration();
					if (!emailConfiguration) return yield* Effect.die(new Error('email_unavailable'));
					const ctx = yield* MutationCtx;
					return yield* Effect.promise(() =>
						resend.sendEmail(ctx, {
							from: emailConfiguration.sender,
							to,
							subject,
							html,
							text,
							headers: [
								{ name: 'X-Email-Category', value: 'stats' },
								{ name: 'X-Email-Template', value: template }
							]
						})
					);
				})
		),
		FunctionImpl.make(databaseSchema, send, 'sendCancellation', ({ notificationId }) =>
			Effect.gen(function* () {
				yield* sendEpisode(notificationId, CANCELLATION_EMAIL);
				return null;
			})
		),
		FunctionImpl.make(databaseSchema, send, 'sendNewCustomer', ({ notificationId }) =>
			Effect.gen(function* () {
				yield* sendEpisode(notificationId, NEW_CUSTOMER_EMAIL);
				return null;
			})
		)
	]),
	GroupImpl.finalize
);
