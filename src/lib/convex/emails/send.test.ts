import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { sendEmail, getEmailDeliveryConfiguration, assertResendApiKey } = vi.hoisted(() => {
	const getConfiguration = vi.fn();
	return {
		sendEmail: vi.fn(),
		getEmailDeliveryConfiguration: getConfiguration,
		assertResendApiKey: vi.fn((configuration = getConfiguration()) => {
			if (configuration.state !== 'ready') {
				const error = new Error(`[capability] email is ${configuration.state}`);
				error.name = 'CapabilityConfigurationError';
				throw error;
			}
			return configuration.value;
		})
	};
});

vi.mock('./resend', () => ({
	resend: { sendEmail },
	getEmailDeliveryConfiguration,
	assertResendApiKey
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

vi.mock('../support/notificationPreferences', () => ({
	shouldSendNotification: vi.fn(() => true)
}));

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

import { shouldSendNotification } from '../support/notificationPreferences';
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

const shouldSendNotificationMock = shouldSendNotification as unknown as ReturnType<typeof vi.fn>;

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
			supportThreadId: 'support_thread_1',
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
		shouldSendNotificationMock.mockReturnValue(true);
		sendEmail.mockResolvedValue('email_1');
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it.each(immediateSendCases)(
		'%s does not query, render, count, or enqueue when email is misconfigured',
		async (name, mutation, args) => {
			getEmailDeliveryConfiguration.mockReturnValue({
				state: 'misconfigured',
				issue: 'sentinel'
			});
			const runQuery = vi.fn();
			const ctx = { runQuery, db: { get: vi.fn(), patch: vi.fn() } };
			const invocation = (mutation as unknown as RegisteredMutation)._handler(ctx, args);

			if (name === 'sendVerificationEmail' || name === 'sendResetPasswordEmail') {
				await expect(invocation).rejects.toThrow('[capability] email is misconfigured');
			} else {
				expect(await invocation).toBe(mutation === sendNewTicketAdminNotification ? false : null);
			}
			expect(runQuery).not.toHaveBeenCalled();
			expect(ctx.db.patch).not.toHaveBeenCalled();
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

	it('rechecks the admin reply cooldown before enqueueing', async () => {
		shouldSendNotificationMock.mockReturnValue(false);
		const patch = vi.fn();
		const runQuery = vi.fn();
		const ctx = {
			db: {
				get: vi.fn().mockResolvedValue({ notificationSentAt: Date.now() }),
				patch
			},
			runQuery
		};

		expect(
			await (sendAdminReplyNotification as unknown as RegisteredMutation)._handler(ctx, {
				supportThreadId: 'support_thread_1',
				email: 'user@example.com',
				adminName: 'Admin',
				messagePreview: 'Reply',
				threadId: 'thread_1'
			})
		).toBeNull();
		expect(sendEmail).not.toHaveBeenCalled();
		expect(patch).not.toHaveBeenCalled();
		expect(runQuery).not.toHaveBeenCalled();
	});

	it('writes the admin reply cooldown only after the component enqueue returns', async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-09-09T00:00:00.000Z'));
		const patch = vi.fn().mockResolvedValue(undefined);
		const ctx = {
			db: {
				get: vi.fn().mockResolvedValue({ notificationSentAt: undefined }),
				patch
			},
			runQuery: vi.fn().mockResolvedValue({ locale: 'en' })
		};

		expect(
			await (sendAdminReplyNotification as unknown as RegisteredMutation)._handler(ctx, {
				supportThreadId: 'support_thread_1',
				email: 'user@example.com',
				adminName: 'Admin',
				messagePreview: 'Reply',
				threadId: 'thread_1'
			})
		).toBeNull();
		expect(sendEmail).toHaveBeenCalledTimes(1);
		expect(patch).toHaveBeenCalledWith('support_thread_1', {
			notificationSentAt: Date.now()
		});
		expect(sendEmail.mock.invocationCallOrder[0]).toBeLessThan(patch.mock.invocationCallOrder[0]);
		vi.useRealTimers();
	});

	it('does not write the admin reply cooldown when the component enqueue fails', async () => {
		sendEmail.mockRejectedValueOnce(new Error('enqueue failed'));
		const patch = vi.fn();
		const ctx = {
			db: {
				get: vi.fn().mockResolvedValue({ notificationSentAt: undefined }),
				patch
			},
			runQuery: vi.fn().mockResolvedValue({ locale: 'en' })
		};

		await expect(
			(sendAdminReplyNotification as unknown as RegisteredMutation)._handler(ctx, {
				supportThreadId: 'support_thread_1',
				email: 'user@example.com',
				adminName: 'Admin',
				messagePreview: 'Reply',
				threadId: 'thread_1'
			})
		).rejects.toThrow('enqueue failed');
		expect(patch).not.toHaveBeenCalled();
	});

	it('lets only the successful admin reply enqueue consume the cooldown', async () => {
		shouldSendNotificationMock.mockImplementation(
			(email: string | undefined, sentAt: number | undefined) => Boolean(email) && !sentAt
		);
		const supportThread: Record<string, unknown> = { notificationSentAt: undefined };
		const patch = vi.fn(async (_id: string, update: Record<string, unknown>) => {
			Object.assign(supportThread, update);
		});
		const ctx = {
			db: {
				get: vi.fn().mockResolvedValue(supportThread),
				patch
			},
			runQuery: vi.fn().mockResolvedValue({ locale: 'en' })
		};
		const args = {
			supportThreadId: 'support_thread_1',
			email: 'user@example.com',
			adminName: 'Admin',
			messagePreview: 'Reply',
			threadId: 'thread_1'
		};

		await (sendAdminReplyNotification as unknown as RegisteredMutation)._handler(ctx, args);
		await (sendAdminReplyNotification as unknown as RegisteredMutation)._handler(ctx, args);

		expect(sendEmail).toHaveBeenCalledTimes(1);
		expect(patch).toHaveBeenCalledTimes(1);
	});

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
