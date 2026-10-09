import { v } from 'convex/values';
import * as val from 'valibot';
import { components, internal } from '../../_generated/api';
import type { Doc, Id } from '../../_generated/dataModel';
import { env, internalMutation, type MutationCtx } from '../../_generated/server';
import { requireEnv } from '../../env';
import { isTestEmail } from '../../emails/helpers';
import { resend } from '../../emails/resend';
import { getLocaleForEmail, getReadyEmailConfiguration } from '../../emails/send';
import { renderNewCustomerAdminNotificationEmail } from '../../emails/templates';
import type { NewCustomerAdminNotificationEmailData } from '../../../emails/templates/types';
import { collectJourney, presentJourney } from '../journey/collect';
import { resolveTimeZone } from '../journey/format';
import { JOURNEY_SOURCES } from '../journey/registry';
import { composeNewCustomer } from './compose';

/**
 * The new-customer admin email: one scheduled run per ledger row, which
 * finishes the row exactly once.
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

/** Recipient discovery: up to 501 preference rows. */
const DISCOVERY_LIMITS = { documentsRead: 510, bytesRead: MiB };

/** One recipient's enqueue: the component's email and content records. */
const ENQUEUE_LIMITS = { documentsWritten: 10, bytesWritten: 256 * KiB };

/** The largest rendered email a recipient gets, in UTF-8 bytes. */
const MAX_PAYLOAD = { html: 128 * KiB, text: 32 * KiB };

const TEMPLATE = 'new-customer';

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

const customerSchema = val.object({
	email: val.string(),
	name: val.optional(val.nullable(val.string()))
});

/** The live customer's name and email, or null once the account is gone. */
async function liveCustomer(ctx: MutationCtx, userId: string) {
	const row: unknown = await ctx.runQuery(components.betterAuth.adapter.findOne, {
		model: 'user',
		where: [{ field: '_id', operator: 'eq', value: userId }]
	});
	const user = val.safeParse(customerSchema, row);
	return user.success ? { name: user.output.name?.trim() ?? '', email: user.output.email } : null;
}

const utf8Bytes = (value: string) => new TextEncoder().encode(value).byteLength;

function withinPayload({ html, text }: RenderedEmail): boolean {
	return utf8Bytes(html) <= MAX_PAYLOAD.html && utf8Bytes(text) <= MAX_PAYLOAD.text;
}

/**
 * The email for one recipient, or null when even the version without the
 * journey is too large to hand to the component.
 */
function renderWithinPayload(
	data: NewCustomerAdminNotificationEmailData,
	locale: string,
	notificationId: Id<'customerNotifications'>
): RenderedEmail | null {
	const full = renderNewCustomerAdminNotificationEmail(data, locale);
	if (withinPayload(full)) return full;
	console.warn({ code: 'journey_payload_oversize', notificationId });
	const fallback = renderNewCustomerAdminNotificationEmail({ ...data, journey: null }, locale);
	if (withinPayload(fallback)) return fallback;
	console.error({ code: 'email_payload_oversize', notificationId });
	return null;
}

async function sendNewCustomerNotification(
	ctx: MutationCtx,
	notificationId: Id<'customerNotifications'>
): Promise<void> {
	const row = await ctx.db.get('customerNotifications', notificationId);
	if (row?.status !== 'scheduled') return;
	const finish = (outcome: Outcome) =>
		ctx.db.patch('customerNotifications', row._id, { ...outcome, completedAt: Date.now() });

	const customer = await liveCustomer(ctx, row.userId);
	if (!customer) return await finish({ status: 'skipped', skippedReason: 'owner_deleted' });
	if (isTestEmail(customer.email)) {
		return await finish({ status: 'skipped', skippedReason: 'test_customer' });
	}
	if (!getReadyEmailConfiguration()) {
		return await finish({ status: 'skipped', skippedReason: 'email_unavailable' });
	}

	let audience: { emails: string[]; truncated: boolean };
	try {
		audience = await ctx.runQuery(
			internal.admin.notificationPreferences.queries.getJourneyRecipients,
			{ type: 'newCustomers' },
			{ transactionLimits: DISCOVERY_LIMITS }
		);
	} catch {
		console.error({ code: 'audience_unavailable', notificationId });
		return await finish({ status: 'failed', failedReason: 'audience_unavailable' });
	}
	const audienceTruncated = audience.truncated ? true : undefined;
	if (audienceTruncated) console.warn({ code: 'audience_truncated', notificationId });
	if (audience.emails.length === 0) {
		return await finish({
			status: 'skipped',
			skippedReason: audienceTruncated ? 'audience_incomplete' : 'no_recipients',
			audienceTruncated
		});
	}

	const collected = await collectJourney(ctx, JOURNEY_SOURCES, row.request);
	const timeZone = resolveTimeZone(env.ADMIN_TIME_ZONE);
	const siteUrl = requireEnv('SITE_URL', { feature: 'email deep links' }).replace(/\/+$/, '');
	const adminDashboardLink = `${siteUrl}/admin/users?search=${encodeURIComponent(customer.email)}`;

	const emailIds: string[] = [];
	let failedCount = 0;
	// Sequential on purpose: each enqueue is its own child transaction, and the
	// audience is bounded by MAX_RECIPIENTS.
	for (const to of audience.emails) {
		try {
			const locale = await getLocaleForEmail(ctx, to);
			const format = { locale, timeZone };
			const composed = composeNewCustomer({
				billing: row.billing,
				presented: presentJourney(collected, format),
				format
			});
			const email = renderWithinPayload(
				{
					customer: customer.name || customer.email,
					customerEmail: customer.email,
					amount: composed.amount,
					previewText: composed.previewText,
					journey: composed.journey,
					timeZone,
					adminDashboardLink
				},
				locale,
				notificationId
			);
			if (!email) {
				failedCount++;
				continue;
			}
			emailIds.push(
				await ctx.runMutation(
					internal.admin.customerNotifications.send.enqueueRecipient,
					{ to, ...email, template: TEMPLATE },
					{ transactionLimits: ENQUEUE_LIMITS }
				)
			);
		} catch {
			console.error({ code: 'email_enqueue_failed', notificationId });
			failedCount++;
		}
	}

	await finish({
		status: emailIds.length > 0 ? 'enqueued' : 'failed',
		emailIds,
		enqueuedCount: emailIds.length,
		failedCount,
		audienceTruncated
	});
}

/** Send the new-customer email for one ledger row. Scheduled by admission. */
export const sendNewCustomer = internalMutation({
	args: { notificationId: v.id('customerNotifications') },
	returns: v.null(),
	handler: async (ctx, { notificationId }) => {
		await sendNewCustomerNotification(ctx, notificationId);
		return null;
	}
});

/**
 * Enqueue one rendered email with the Resend component and return its id.
 * Called only by the sender above, under write limits, whose catch keeps a
 * throw here from undoing any other recipient.
 */
export const enqueueRecipient = internalMutation({
	args: {
		to: v.string(),
		subject: v.string(),
		html: v.string(),
		text: v.string(),
		template: v.literal(TEMPLATE)
	},
	returns: v.string(),
	handler: async (ctx, { to, subject, html, text, template }): Promise<string> => {
		const emailConfiguration = getReadyEmailConfiguration();
		if (!emailConfiguration) throw new Error('email_unavailable');
		return await resend.sendEmail(ctx, {
			from: emailConfiguration.sender,
			to,
			subject,
			html,
			text,
			headers: [
				{ name: 'X-Email-Category', value: 'stats' },
				{ name: 'X-Email-Template', value: template }
			]
		});
	}
});
