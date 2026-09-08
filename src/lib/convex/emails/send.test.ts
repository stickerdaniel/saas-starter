import { beforeEach, describe, expect, it, vi } from 'vitest';

const { sendEmail, getEmailDeliveryConfiguration } = vi.hoisted(() => ({
	sendEmail: vi.fn(),
	getEmailDeliveryConfiguration: vi.fn()
}));

vi.mock('./resend', () => ({
	resend: { sendEmail },
	getEmailDeliveryConfiguration,
	assertResendApiKey: vi.fn((configuration) => configuration.value)
}));

vi.mock('./templates', () => ({
	renderVerificationEmail: vi.fn(() => ({ html: 'html', text: 'text' })),
	renderPasswordResetEmail: vi.fn(() => ({ html: 'html', text: 'text' })),
	renderAdminReplyNotificationEmail: vi.fn(() => ({ html: 'html', text: 'text' })),
	renderNewTicketAdminNotificationEmail: vi.fn(() => ({ html: 'html', text: 'text' })),
	renderNewUserSignupNotificationEmail: vi.fn(() => ({ html: 'html', text: 'text' }))
}));

vi.mock('./helpers', () => ({
	buildSupportDeepLink: vi.fn(() => 'https://app.example.com/support'),
	shouldSkipTestEmail: vi.fn(() => false)
}));

vi.mock('../credentialAccounts', () => ({ hasUsablePassword: vi.fn(() => true) }));

vi.mock('../env', () => ({ requireEnv: vi.fn(() => 'https://app.example.com') }));

vi.mock('../i18n/translations', () => ({
	t: vi.fn(() => 'subject'),
	getValidLocale: vi.fn(() => 'en')
}));

vi.mock('../_generated/api', () => ({
	components: {
		betterAuth: { adapter: { findOne: 'components.betterAuth.adapter.findOne' } }
	},
	internal: {
		admin: {
			founderWelcome: {
				queries: {
					getFounderWelcomeConfigInternal:
						'internal.admin.founderWelcome.queries.getFounderWelcomeConfigInternal'
				}
			},
			notificationPreferences: {
				queries: {
					getRecipientsForNotificationType:
						'internal.admin.notificationPreferences.queries.getRecipientsForNotificationType'
				}
			}
		}
	}
}));

import {
	sendAdminReplyNotification,
	sendFounderWelcomeEmail,
	sendNewTicketAdminNotification,
	sendNewUserSignupNotification,
	sendResetPasswordEmail,
	sendVerificationEmail
} from './send';

type RegisteredMutation = {
	_handler: (ctx: unknown, args: Record<string, unknown>) => Promise<unknown>;
};

const immediateSendCases = [
	[
		'sendVerificationEmail',
		sendVerificationEmail,
		{ email: 'user@example.com', verificationUrl: 'https://app.example.com/verify' }
	],
	[
		'sendResetPasswordEmail',
		sendResetPasswordEmail,
		{
			email: 'user@example.com',
			resetUrl: 'https://app.example.com/reset',
			userId: 'user_1'
		}
	],
	[
		'sendAdminReplyNotification',
		sendAdminReplyNotification,
		{
			email: 'user@example.com',
			adminName: 'Admin',
			messagePreview: 'Reply',
			threadId: 'thread_1'
		}
	],
	[
		'sendNewTicketAdminNotification',
		sendNewTicketAdminNotification,
		{
			email: 'admin@example.com',
			isReopen: false,
			isBareHandoff: false,
			userName: 'User',
			messages: [],
			threadId: 'thread_1'
		}
	],
	[
		'sendNewUserSignupNotification',
		sendNewUserSignupNotification,
		{
			userEmail: 'user@example.com',
			signupMethod: 'Email',
			signupTime: 'now'
		}
	]
] as const;

function readyEmailConfiguration() {
	return {
		state: 'ready' as const,
		value: {
			apiKey: 'configured',
			sender: 'sender@example.com',
			assetUrl: 'https://assets.example.com'
		}
	};
}

describe('email send provider preflights', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		getEmailDeliveryConfiguration.mockReturnValue(readyEmailConfiguration());
		sendEmail.mockResolvedValue('email_1');
	});

	it.each(immediateSendCases)(
		'%s does not query, render, count, or enqueue when email is misconfigured',
		async (_name, mutation, args) => {
			getEmailDeliveryConfiguration.mockReturnValue({
				state: 'misconfigured',
				issue: 'sentinel'
			});
			const runQuery = vi.fn();
			const ctx = { runQuery, db: { get: vi.fn(), patch: vi.fn() } };

			const result = await (mutation as unknown as RegisteredMutation)._handler(ctx, args);

			expect(result).toBe(mutation === sendNewTicketAdminNotification ? false : null);
			expect(runQuery).not.toHaveBeenCalled();
			expect(sendEmail).not.toHaveBeenCalled();
		}
	);

	it.each(['disabled', 'misconfigured'] as const)(
		'marks a scheduled founder welcome terminal when email is %s',
		async (state) => {
			getEmailDeliveryConfiguration.mockReturnValue(
				state === 'disabled' ? { state } : { state, issue: 'missing' }
			);
			const patch = vi.fn().mockResolvedValue(undefined);
			const runQuery = vi.fn();
			const ctx = {
				db: {
					get: vi.fn().mockResolvedValue({
						status: 'scheduled',
						userId: 'user_1',
						signupEmail: 'user@example.com'
					}),
					patch
				},
				runQuery
			};

			expect(
				await (sendFounderWelcomeEmail as unknown as RegisteredMutation)._handler(ctx, {
					founderWelcomeId: 'welcome_1'
				})
			).toBeNull();
			expect(patch).toHaveBeenCalledWith('welcome_1', {
				status: 'skipped',
				skippedReason: 'email_unavailable'
			});
			expect(runQuery).not.toHaveBeenCalled();
			expect(sendEmail).not.toHaveBeenCalled();
		}
	);

	it('returns an enqueue result that pending notification work can count', async () => {
		const ctx = { runQuery: vi.fn().mockResolvedValue({ locale: 'en' }) };

		expect(
			await (sendNewTicketAdminNotification as unknown as RegisteredMutation)._handler(ctx, {
				email: 'admin@example.com',
				isReopen: false,
				isBareHandoff: false,
				userName: 'User',
				messages: [],
				threadId: 'thread_1'
			})
		).toBe(true);
		expect(sendEmail).toHaveBeenCalledTimes(1);
	});
});
