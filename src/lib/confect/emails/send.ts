import { internalMutation } from '../../convex/_generated/server';
import { v } from 'convex/values';
import { components, internal } from '../../convex/_generated/api';
import { resend, assertResendApiKey, getEmailDeliveryConfiguration } from './resend';
import {
	renderVerificationEmail,
	renderPasswordResetEmail,
	renderAdminReplyNotificationEmail,
	renderNewTicketAdminNotificationEmail,
	renderNewUserSignupNotificationEmail,
	renderSupportRateLimitAlertEmail,
	getRateLimitAlertLimitName
} from './templates';
import { requireEnv } from '../env';
import type {
	NotificationMessage,
	SupportRateLimitAlertEmailData
} from '../../emails/templates/types';
import { t, getValidLocale, type SupportedLocale } from '../i18n/translations';
import type { GenericMutationCtx } from 'convex/server';
import type { DataModel } from '../../convex/_generated/dataModel';
import { buildSupportDeepLink, shouldSkipTestEmail } from './helpers';
import { renderFounderEmail, renderFounderTemplate } from './founderTemplate';
import { checkFounderRecipient } from './founderEmailConfig';
import { hasUsablePassword } from '../credentialAccounts';
import { withPasswordLinkPurpose } from '../utils/passwordLinkPurpose';
import { shouldSendNotification } from '../support/notificationPreferences';

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

export const sendVerificationEmail = internalMutation({
	args: {
		email: v.string(),
		verificationUrl: v.string(),
		expiryMinutes: v.optional(v.number())
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const { email, verificationUrl, expiryMinutes = 20 } = args;

		if (shouldSkipTestEmail('sendVerificationEmail', email)) return null;
		assertResendApiKey();

		const locale = await getLocaleForEmail(ctx, email);
		const { html, text } = renderVerificationEmail(verificationUrl, expiryMinutes, locale);
		const emailConfiguration = assertResendApiKey();

		await resend.sendEmail(ctx, {
			from: emailConfiguration.sender,
			to: email,
			subject: t(locale, 'email.subject.verify'),
			html,
			text,
			headers: [
				{ name: 'X-Email-Category', value: 'authentication' },
				{ name: 'X-Email-Template', value: 'verification' }
			]
		});
		return null;
	}
});

export const sendResetPasswordEmail = internalMutation({
	args: {
		email: v.string(),
		resetUrl: v.string(),
		userName: v.optional(v.string()),
		userId: v.string()
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const { email, resetUrl, userName } = args;

		if (shouldSkipTestEmail('sendResetPasswordEmail', email)) return null;
		assertResendApiKey();

		// Resolved here rather than in the caller: the reset hook awaits that
		// caller, so the lookup would sit on the response path as its own round
		// trip. Inside the mutation it shares this transaction.
		const hasPassword = await hasUsablePassword(ctx, args.userId);
		const locale = await getLocaleForEmail(ctx, email);
		// The page the link opens words itself from this too.
		const link = withPasswordLinkPurpose(resetUrl, hasPassword ? 'reset' : 'set');
		const { html, text } = renderPasswordResetEmail(link, userName, locale, hasPassword);
		const emailConfiguration = assertResendApiKey();

		await resend.sendEmail(ctx, {
			from: emailConfiguration.sender,
			to: email,
			subject: t(
				locale,
				hasPassword ? 'email.subject.reset_password' : 'email.subject.set_password'
			),
			html,
			text,
			headers: [
				{ name: 'X-Email-Category', value: 'authentication' },
				{ name: 'X-Email-Template', value: hasPassword ? 'password-reset' : 'password-set' }
			]
		});
		return null;
	}
});

export const sendAdminReplyNotification = internalMutation({
	args: {
		supportThreadId: v.id('supportThreads'),
		email: v.string(),
		adminName: v.string(),
		messagePreview: v.string(),
		threadId: v.string(),
		pageUrl: v.optional(v.string())
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const { supportThreadId, email, adminName, messagePreview, threadId, pageUrl } = args;

		if (shouldSkipTestEmail('sendAdminReplyNotification', email)) return null;
		if (!getReadyEmailConfiguration()) return null;

		const supportThread = await ctx.db.get('supportThreads', supportThreadId);
		if (!supportThread || !shouldSendNotification(email, supportThread.notificationSentAt)) {
			return null;
		}

		const locale = await getLocaleForEmail(ctx, email);
		const siteUrl = requireEnv('SITE_URL', { feature: 'email deep links' });

		const deepLink = buildSupportDeepLink(pageUrl, siteUrl, threadId);

		const { html, text } = renderAdminReplyNotificationEmail(
			adminName,
			messagePreview,
			deepLink,
			locale
		);
		const emailConfiguration = getReadyEmailConfiguration();
		if (!emailConfiguration) return null;

		await resend.sendEmail(ctx, {
			from: emailConfiguration.sender,
			to: email,
			subject: t(locale, 'email.subject.support_reply'),
			html,
			text,
			headers: [
				{ name: 'X-Email-Category', value: 'support' },
				{ name: 'X-Email-Template', value: 'admin-reply' },
				{ name: 'X-Thread-ID', value: threadId }
			]
		});
		await ctx.db.patch('supportThreads', supportThreadId, { notificationSentAt: Date.now() });
		return null;
	}
});

/** Sends one recipient's debounced ticket email. Returns whether an email was enqueued. */
export const sendNewTicketAdminNotification = internalMutation({
	args: {
		email: v.string(),
		isReopen: v.boolean(),
		isBareHandoff: v.boolean(),
		userName: v.string(),
		messages: v.array(
			v.object({
				text: v.string(),
				timestamp: v.string()
			})
		),
		threadId: v.string()
	},
	returns: v.boolean(),
	handler: async (ctx, args) => {
		const { email, isReopen, isBareHandoff, userName, messages, threadId } = args;

		// Nothing is enqueued for a test recipient, so it must not count as a send.
		// sendPendingAdminNotification drops these addresses before sending.
		if (shouldSkipTestEmail('sendNewTicketAdminNotification', email)) return false;
		if (!getReadyEmailConfiguration()) return false;
		const siteUrl = requireEnv('SITE_URL', { feature: 'email deep links' });
		const locale = await getLocaleForEmail(ctx, email);

		const adminDashboardLink = `${siteUrl}/admin/support?thread=${threadId}`;

		const { html, text } = renderNewTicketAdminNotificationEmail(
			{
				isReopen,
				isBareHandoff,
				userName,
				messages: messages as NotificationMessage[],
				adminDashboardLink
			},
			locale
		);

		const subject = isReopen
			? t(locale, 'email.subject.ticket_reopened', { userName })
			: t(locale, 'email.subject.ticket_new', { userName });
		const emailConfiguration = getReadyEmailConfiguration();
		if (!emailConfiguration) return false;

		await resend.sendEmail(ctx, {
			from: emailConfiguration.sender,
			to: email,
			subject,
			html,
			text,
			headers: [
				{ name: 'X-Email-Category', value: 'support-admin' },
				{ name: 'X-Email-Template', value: isReopen ? 'ticket-reopened' : 'new-ticket' },
				{ name: 'X-Thread-ID', value: threadId }
			]
		});
		return true;
	}
});

/**
 * Scheduled by the auth triggers. Every recipient with signup notifications
 * enabled, admin or custom email, gets one.
 */
export const sendNewUserSignupNotification = internalMutation({
	args: {
		userName: v.optional(v.string()),
		userEmail: v.string(),
		signupMethod: v.union(v.literal('Email'), v.literal('Google'), v.literal('GitHub')),
		signupTime: v.string()
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const { userName, userEmail, signupMethod, signupTime } = args;

		if (shouldSkipTestEmail('sendNewUserSignupNotification', userEmail)) return null;
		if (!getReadyEmailConfiguration()) return null;

		const recipients = await ctx.runQuery(
			internal.admin.notificationPreferences.queries.getRecipientsForNotificationType,
			{ type: 'newSignups' }
		);

		if (recipients.length === 0) {
			console.log('[sendNewUserSignupNotification] No recipients configured, skipping');
			return null;
		}

		const siteUrl = requireEnv('SITE_URL', { feature: 'email deep links' });

		const adminDashboardLink = `${siteUrl}/admin/users?search=${encodeURIComponent(userEmail)}`;

		// The Resend component retries transient failures internally via workpool
		// (5 retries, 30s backoff). Its idempotency key is the per-enqueue email record id,
		// so it only dedupes retries of an already-enqueued email. Duplicate-send safety
		// across re-runs of this loop comes from Convex's exactly-once scheduled-mutation
		// execution (scheduled from the auth onCreate/onUpdate triggers, auth.ts).
		let sentCount = 0;
		let emailUnavailable = false;
		for (const email of recipients) {
			try {
				// Per-recipient locale lookup and render: recipient list is small
				// (admins + custom notification emails, typically <10 rows)
				const locale = await getLocaleForEmail(ctx, email);
				const { html, text } = renderNewUserSignupNotificationEmail(
					{
						userName: userName || 'New User',
						userEmail,
						signupMethod,
						signupTime,
						adminDashboardLink
					},
					locale
				);
				const emailConfiguration = getReadyEmailConfiguration();
				if (!emailConfiguration) {
					emailUnavailable = true;
					break;
				}
				await resend.sendEmail(ctx, {
					from: emailConfiguration.sender,
					to: email,
					subject: t(locale, 'email.subject.new_signup', { userEmail }),
					html,
					text,
					headers: [
						{ name: 'X-Email-Category', value: 'stats' },
						{ name: 'X-Email-Template', value: 'new-user-signup' }
					]
				});
				sentCount++;
			} catch {
				// The Resend component retries transient errors, so this logs permanent
				// ones such as an invalid configuration or API key
				console.error({ code: 'signup_notification_enqueue_failed' });
			}
		}

		if (emailUnavailable && sentCount === 0) return null;

		if (sentCount > 0) {
			console.log(
				`[sendNewUserSignupNotification] Enqueued notification for ${userEmail} to ${sentCount}/${recipients.length} recipient(s)`
			);
		} else if (recipients.length > 0) {
			console.error(
				`[sendNewUserSignupNotification] All ${recipients.length} email sends failed for new user ${userEmail}`
			);
		}
		return null;
	}
});

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

/**
 * Reads the configuration from adminSettings at send time, so the latest one
 * applies. Sends a text part and a minimal HTML part, and stores the component
 * email id and rendered subject on the row.
 */
export const sendFounderWelcomeEmail = internalMutation({
	args: { founderWelcomeId: v.id('founderWelcomeEmails') },
	returns: v.null(),
	handler: async (ctx, { founderWelcomeId }) => {
		const row = await ctx.db.get('founderWelcomeEmails', founderWelcomeId);
		if (!row || row.status !== 'scheduled') return null;
		if (!getReadyEmailConfiguration()) {
			await ctx.db.patch('founderWelcomeEmails', founderWelcomeId, {
				status: 'skipped',
				skippedReason: 'email_unavailable'
			});
			return null;
		}

		const config = await ctx.runQuery(
			internal.admin.founderWelcome.queries.getFounderWelcomeConfigInternal,
			{}
		);
		if (!config.enabled) {
			await ctx.db.patch('founderWelcomeEmails', founderWelcomeId, {
				status: 'skipped',
				skippedReason: 'feature_disabled'
			});
			return null;
		}

		// Guards shared with the other founder emails, the opt-out included
		const recipient = await checkFounderRecipient(ctx, {
			userId: row.userId,
			recipientEmail: row.signupEmail,
			logContext: 'sendFounderWelcomeEmail'
		});
		if (!recipient.ok) {
			await ctx.db.patch('founderWelcomeEmails', founderWelcomeId, {
				status: 'skipped',
				skippedReason: recipient.reason
			});
			return null;
		}
		const { email, name } = recipient.user;

		if (!config.subject.trim() || !config.body.trim()) {
			await ctx.db.patch('founderWelcomeEmails', founderWelcomeId, {
				status: 'skipped',
				skippedReason: 'empty_template'
			});
			return null;
		}

		const parts = (name?.trim() || 'there').split(/\s+/);
		const templateVars = {
			userFirstName: parts[0] ?? '',
			userLastName: parts.slice(1).join(' '),
			founderName: config.name,
			founderTitle: config.title
		};
		const { text, html } = renderFounderEmail(config.body, templateVars);
		const subject = renderFounderTemplate(config.subject, templateVars);
		const emailConfiguration = getReadyEmailConfiguration();
		if (!emailConfiguration) {
			await ctx.db.patch('founderWelcomeEmails', founderWelcomeId, {
				status: 'skipped',
				skippedReason: 'email_unavailable'
			});
			return null;
		}

		const emailId = await resend.sendEmail(ctx, {
			from: `${config.name} <${emailConfiguration.sender}>`,
			replyTo: config.replyTo ? [config.replyTo] : undefined,
			to: email,
			subject,
			text,
			html,
			headers: [
				{ name: 'X-Email-Category', value: 'onboarding' },
				{ name: 'X-Email-Template', value: 'founder-welcome' }
			]
		});

		await ctx.db.patch('founderWelcomeEmails', founderWelcomeId, {
			status: 'sent',
			sentAt: Date.now(),
			emailId,
			subject
		});
		return null;
	}
});
