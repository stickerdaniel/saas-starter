import type { GenericMutationCtx } from 'convex/server';
import { components, internal } from '../../convex/_generated/api';
import type { DataModel } from '../../convex/_generated/dataModel';
import type { SupportRateLimitAlertEmailData } from '../../emails/templates/types';
import { requireEnv } from '../env';
import { getValidLocale, t, type SupportedLocale } from '../i18n/translations';
import { shouldSkipTestEmail } from './helpers';
import { assertResendApiKey, getEmailDeliveryConfiguration, resend } from './resend';
import { getRateLimitAlertLimitName, renderSupportRateLimitAlertEmail } from './templates';

type UserWithLocale = { locale?: string | null } | null;

/** The validated email configuration, or null while email is not ready. */
export function getReadyEmailConfiguration() {
	const configuration = getEmailDeliveryConfiguration();
	return configuration.state === 'ready' ? assertResendApiKey(configuration) : null;
}

/** Falls back to the default locale when the user or its locale is missing. */
export async function getLocaleForEmail(
	ctx: GenericMutationCtx<DataModel>,
	email: string
): Promise<SupportedLocale> {
	const result = await ctx.runQuery(components.betterAuth.adapter.findOne, {
		model: 'user',
		where: [{ field: 'email', operator: 'eq', value: email }]
	});
	return getValidLocale((result as UserWithLocale)?.locale);
}

/**
 * Alerts admins when a global anonymous support rate limit runs low.
 *
 * Called by the sampling cron (support/rateLimitAlerts.ts) inside its own
 * transaction, so the cron stays the only writer of the alert state and
 * starts the cooldown only when this returns a count above zero. Goes to
 * recipients with new support ticket notifications enabled: the people who
 * handle anonymous support are the ones who notice when it stops accepting
 * visitors.
 *
 * @returns How many emails were enqueued. A failed enqueue is a
 * sub-transaction that rolls back its own writes and does not count.
 */
export async function sendSupportRateLimitAlert(
	ctx: GenericMutationCtx<DataModel>,
	data: Omit<SupportRateLimitAlertEmailData, 'adminDashboardLink'>
): Promise<number> {
	if (!getReadyEmailConfiguration()) return 0;

	const recipients = await ctx.runQuery(
		internal.admin.notificationPreferences.queries.getRecipientsForNotificationType,
		{ type: 'newTickets' }
	);
	if (recipients.length === 0) {
		console.log('[sendSupportRateLimitAlert] No recipients configured, skipping');
		return 0;
	}

	const siteUrl = requireEnv('SITE_URL', { feature: 'email deep links' });
	const adminDashboardLink = `${siteUrl}/admin/support`;

	// Same per-recipient loop and failure handling as sendNewUserSignupNotification.
	let sentCount = 0;
	for (const email of recipients) {
		if (shouldSkipTestEmail('sendSupportRateLimitAlert', email)) continue;
		try {
			const locale = await getLocaleForEmail(ctx, email);
			const { html, text } = renderSupportRateLimitAlertEmail(
				{ ...data, adminDashboardLink },
				locale
			);
			const emailConfiguration = getReadyEmailConfiguration();
			if (!emailConfiguration) break;
			await resend.sendEmail(ctx, {
				from: emailConfiguration.sender,
				to: email,
				subject: t(locale, 'email.subject.rate_limit_alert', {
					limitName: getRateLimitAlertLimitName(data.bucket, locale)
				}),
				html,
				text,
				headers: [
					{ name: 'X-Email-Category', value: 'support-admin' },
					{ name: 'X-Email-Template', value: 'support-rate-limit-alert' }
				]
			});
			sentCount++;
		} catch {
			// The Resend component retries transient errors; log permanent ones.
			console.error({ code: 'support_rate_limit_alert_enqueue_failed' });
		}
	}
	return sentCount;
}
