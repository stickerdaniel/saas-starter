import { FunctionImpl, GroupImpl } from '@confect/server';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import { internal } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import type { MutationCtx as ConvexMutationCtx } from '../../convex/_generated/server';
import type { FounderWelcomeConfig } from '../admin/founderWelcome/queries';
import databaseSchema from '../_generated/schema';
import { MutationCtx } from '../_generated/services';
import { hasUsablePassword } from '../credentialAccounts';
import { requireEnv } from '../env';
import { t } from '../i18n/translations';
import { shouldSendNotification } from '../support/notificationPreferences';
import { withPasswordLinkPurpose } from '../utils/passwordLinkPurpose';
import { checkFounderRecipient } from './founderEmailConfig';
import { renderFounderEmail, renderFounderTemplate } from './founderTemplate';
import { buildSupportDeepLink, shouldSkipTestEmail } from './helpers';
import { assertResendApiKey, resend } from './resend';
import { getLocaleForEmail, getReadyEmailConfiguration } from './send';
import send from './send.spec';
import {
	renderAdminReplyNotificationEmail,
	renderNewTicketAdminNotificationEmail,
	renderNewUserSignupNotificationEmail,
	renderPasswordResetEmail,
	renderVerificationEmail
} from './templates';

type SignupOutcome = 'sent' | 'unavailable' | 'failed';

const skipWelcome = (
	ctx: ConvexMutationCtx,
	founderWelcomeId: Id<'founderWelcomeEmails'>,
	skippedReason: string
) =>
	Effect.promise(() =>
		ctx.db.patch('founderWelcomeEmails', founderWelcomeId, { status: 'skipped', skippedReason })
	).pipe(Effect.as(null));

export default GroupImpl.make(databaseSchema, send).pipe(
	Layer.provide([
		FunctionImpl.make(
			databaseSchema,
			send,
			'sendAdminReplyNotification',
			({ supportThreadId, email, adminName, messagePreview, threadId, pageUrl }) =>
				Effect.gen(function* () {
					if (shouldSkipTestEmail('sendAdminReplyNotification', email)) return null;
					if (!getReadyEmailConfiguration()) return null;

					const ctx = yield* MutationCtx;
					const supportThread = yield* Effect.promise(() =>
						ctx.db.get('supportThreads', supportThreadId)
					);
					if (!supportThread || !shouldSendNotification(email, supportThread.notificationSentAt)) {
						return null;
					}

					const locale = yield* Effect.promise(() => getLocaleForEmail(ctx, email));
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

					yield* Effect.promise(() =>
						resend.sendEmail(ctx, {
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
						})
					);
					yield* Effect.promise(() =>
						ctx.db.patch('supportThreads', supportThreadId, { notificationSentAt: Date.now() })
					);
					return null;
				})
		),
		FunctionImpl.make(databaseSchema, send, 'sendFounderWelcomeEmail', ({ founderWelcomeId }) =>
			Effect.gen(function* () {
				const ctx = yield* MutationCtx;
				const row = yield* Effect.promise(() =>
					ctx.db.get('founderWelcomeEmails', founderWelcomeId)
				);
				if (!row || row.status !== 'scheduled') return null;
				if (!getReadyEmailConfiguration()) {
					return yield* skipWelcome(ctx, founderWelcomeId, 'email_unavailable');
				}

				const config = yield* Effect.promise((): Promise<FounderWelcomeConfig> =>
					ctx.runQuery(internal.admin.founderWelcome.queries.getFounderWelcomeConfigInternal, {})
				);
				if (!config.enabled) return yield* skipWelcome(ctx, founderWelcomeId, 'feature_disabled');

				const recipient = yield* Effect.promise(() =>
					checkFounderRecipient(ctx, {
						userId: row.userId,
						recipientEmail: row.signupEmail,
						logContext: 'sendFounderWelcomeEmail'
					})
				);
				if (!recipient.ok) return yield* skipWelcome(ctx, founderWelcomeId, recipient.reason);
				const { email, name } = recipient.user;

				if (!config.subject.trim() || !config.body.trim()) {
					return yield* skipWelcome(ctx, founderWelcomeId, 'empty_template');
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
					return yield* skipWelcome(ctx, founderWelcomeId, 'email_unavailable');
				}

				const emailId = yield* Effect.promise(() =>
					resend.sendEmail(ctx, {
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
					})
				);
				yield* Effect.promise(() =>
					ctx.db.patch('founderWelcomeEmails', founderWelcomeId, {
						status: 'sent',
						sentAt: Date.now(),
						emailId,
						subject
					})
				);
				return null;
			})
		),
		FunctionImpl.make(
			databaseSchema,
			send,
			'sendNewTicketAdminNotification',
			({ email, isReopen, isBareHandoff, userName, messages, threadId }) =>
				Effect.gen(function* () {
					if (shouldSkipTestEmail('sendNewTicketAdminNotification', email)) return false;
					if (!getReadyEmailConfiguration()) return false;
					const siteUrl = requireEnv('SITE_URL', { feature: 'email deep links' });
					const ctx = yield* MutationCtx;
					const locale = yield* Effect.promise(() => getLocaleForEmail(ctx, email));
					const adminDashboardLink = `${siteUrl}/admin/support?thread=${threadId}`;
					const { html, text } = renderNewTicketAdminNotificationEmail(
						{ isReopen, isBareHandoff, userName, messages, adminDashboardLink },
						locale
					);
					const subject = isReopen
						? t(locale, 'email.subject.ticket_reopened', { userName })
						: t(locale, 'email.subject.ticket_new', { userName });
					const emailConfiguration = getReadyEmailConfiguration();
					if (!emailConfiguration) return false;

					yield* Effect.promise(() =>
						resend.sendEmail(ctx, {
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
						})
					);
					return true;
				})
		),
		FunctionImpl.make(
			databaseSchema,
			send,
			'sendNewUserSignupNotification',
			({ userName, userEmail, signupMethod, signupTime }) =>
				Effect.gen(function* () {
					if (shouldSkipTestEmail('sendNewUserSignupNotification', userEmail)) return null;
					if (!getReadyEmailConfiguration()) return null;

					const ctx = yield* MutationCtx;
					const recipients = yield* Effect.promise((): Promise<string[]> =>
						ctx.runQuery(
							internal.admin.notificationPreferences.queries.getRecipientsForNotificationType,
							{ type: 'newSignups' }
						)
					);
					if (recipients.length === 0) {
						yield* Effect.log('[sendNewUserSignupNotification] No recipients configured, skipping');
						return null;
					}

					const siteUrl = requireEnv('SITE_URL', { feature: 'email deep links' });
					const adminDashboardLink = `${siteUrl}/admin/users?search=${encodeURIComponent(userEmail)}`;

					const sendTo = (email: string): Effect.Effect<SignupOutcome> =>
						Effect.gen(function* () {
							const locale = yield* Effect.promise(() => getLocaleForEmail(ctx, email));
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
							if (!emailConfiguration) return 'unavailable' as const;
							yield* Effect.promise(() =>
								resend.sendEmail(ctx, {
									from: emailConfiguration.sender,
									to: email,
									subject: t(locale, 'email.subject.new_signup', { userEmail }),
									html,
									text,
									headers: [
										{ name: 'X-Email-Category', value: 'stats' },
										{ name: 'X-Email-Template', value: 'new-user-signup' }
									]
								})
							);
							return 'sent' as const;
						}).pipe(
							Effect.catchCause(() =>
								Effect.logError({ code: 'signup_notification_enqueue_failed' }).pipe(
									Effect.as('failed' as const)
								)
							)
						);

					let sentCount = 0;
					let emailUnavailable = false;
					for (const email of recipients) {
						const outcome = yield* sendTo(email);
						if (outcome === 'unavailable') {
							emailUnavailable = true;
							break;
						}
						if (outcome === 'sent') sentCount++;
					}

					if (emailUnavailable && sentCount === 0) return null;

					if (sentCount > 0) {
						yield* Effect.log(
							`[sendNewUserSignupNotification] Enqueued notification for ${userEmail} to ${sentCount}/${recipients.length} recipient(s)`
						);
					} else if (recipients.length > 0) {
						yield* Effect.logError(
							`[sendNewUserSignupNotification] All ${recipients.length} email sends failed for new user ${userEmail}`
						);
					}
					return null;
				})
		),
		FunctionImpl.make(
			databaseSchema,
			send,
			'sendResetPasswordEmail',
			({ email, resetUrl, userName, userId }) =>
				Effect.gen(function* () {
					if (shouldSkipTestEmail('sendResetPasswordEmail', email)) return null;
					yield* Effect.sync(() => assertResendApiKey());

					const ctx = yield* MutationCtx;
					const hasPassword = yield* Effect.promise(() => hasUsablePassword(ctx, userId));
					const locale = yield* Effect.promise(() => getLocaleForEmail(ctx, email));
					const link = withPasswordLinkPurpose(resetUrl, hasPassword ? 'reset' : 'set');
					const { html, text } = renderPasswordResetEmail(link, userName, locale, hasPassword);
					const emailConfiguration = yield* Effect.sync(() => assertResendApiKey());

					yield* Effect.promise(() =>
						resend.sendEmail(ctx, {
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
								{
									name: 'X-Email-Template',
									value: hasPassword ? 'password-reset' : 'password-set'
								}
							]
						})
					);
					return null;
				})
		),
		FunctionImpl.make(
			databaseSchema,
			send,
			'sendVerificationEmail',
			({ email, verificationUrl, expiryMinutes }) =>
				Effect.gen(function* () {
					if (shouldSkipTestEmail('sendVerificationEmail', email)) return null;
					yield* Effect.sync(() => assertResendApiKey());

					const ctx = yield* MutationCtx;
					const locale = yield* Effect.promise(() => getLocaleForEmail(ctx, email));
					const { html, text } = renderVerificationEmail(
						verificationUrl,
						expiryMinutes ?? 20,
						locale
					);
					const emailConfiguration = yield* Effect.sync(() => assertResendApiKey());

					yield* Effect.promise(() =>
						resend.sendEmail(ctx, {
							from: emailConfiguration.sender,
							to: email,
							subject: t(locale, 'email.subject.verify'),
							html,
							text,
							headers: [
								{ name: 'X-Email-Category', value: 'authentication' },
								{ name: 'X-Email-Template', value: 'verification' }
							]
						})
					);
					return null;
				})
		)
	]),
	GroupImpl.finalize
);
