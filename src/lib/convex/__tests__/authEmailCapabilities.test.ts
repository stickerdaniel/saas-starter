// @vitest-environment node

import { betterAuth } from 'better-auth';
import { memoryAdapter } from 'better-auth/adapters/memory';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../_generated/api', () => ({
	components: {
		betterAuth: { adapter: { findOne: 'components.betterAuth.adapter.findOne' } },
		resend: {}
	},
	internal: {
		auth: {},
		emails: {
			events: { handleEmailEvent: 'internal.emails.events.handleEmailEvent' },
			send: {
				sendVerificationEmail: 'internal.emails.send.sendVerificationEmail',
				sendResetPasswordEmail: 'internal.emails.send.sendResetPasswordEmail'
			}
		}
	}
}));

vi.mock('../_generated/server', () => ({
	env: process.env,
	query: (definition: unknown) => definition,
	mutation: (definition: unknown) => definition,
	internalMutation: (definition: { handler: unknown }) => ({
		...definition,
		_handler: definition.handler
	})
}));

type RegisteredMutation = {
	_handler: (ctx: unknown, args: Record<string, unknown>) => Promise<unknown>;
};

const credentials = {
	name: 'Capability Probe',
	email: 'capability@example.test',
	password: 'correct-horse-battery-staple'
};

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllEnvs();
	vi.resetModules();
});

describe('authentication email capability failures', () => {
	it('propagates real mutation failures through callbacks and Better Auth routes', async () => {
		vi.stubEnv('SITE_URL', 'https://example.test');
		vi.stubEnv('BETTER_AUTH_SECRET', 'test-secret-that-is-long-enough-for-signing');
		vi.stubEnv('RESEND_API_KEY', 'configured-resend-key');
		vi.stubEnv('AUTH_EMAIL', 'sender@example.com');
		vi.stubEnv('EMAIL_ASSET_URL', 'https://assets.example.com');

		const [{ createAuthOptions }, sendModule, resendModule, { CapabilityConfigurationError }] =
			await Promise.all([
				import('../auth'),
				import('../emails/send'),
				import('../emails/resend'),
				import('../env')
			]);
		const sendVerificationEmail = sendModule.sendVerificationEmail as unknown as RegisteredMutation;
		const sendResetPasswordEmail =
			sendModule.sendResetPasswordEmail as unknown as RegisteredMutation;
		const enqueue = vi
			.spyOn(resendModule.resend, 'sendEmail')
			.mockResolvedValue('email_1' as never);
		const mutationCtx = {
			runQuery: vi.fn().mockResolvedValue({ locale: 'en' })
		};
		const callbackCtx = {
			runMutation: vi.fn(async (_reference: unknown, args: Record<string, unknown>) => {
				if ('verificationUrl' in args) {
					return await sendVerificationEmail._handler(mutationCtx, args);
				}
				return await sendResetPasswordEmail._handler(mutationCtx, args);
			})
		};
		const options = createAuthOptions(callbackCtx as never);
		const auth = betterAuth({
			baseURL: 'https://example.test',
			secret: 'test-secret-that-is-long-enough-for-signing',
			database: memoryAdapter({ user: [], session: [], account: [], verification: [] }),
			emailAndPassword: options.emailAndPassword,
			emailVerification: options.emailVerification
		});

		await auth.api.signUpEmail({ body: credentials });
		enqueue.mockClear();
		callbackCtx.runMutation.mockClear();
		vi.stubEnv('AUTH_EMAIL', 'malformed-sender');

		await expect(
			sendVerificationEmail._handler(
				{},
				{
					email: credentials.email,
					verificationUrl: 'https://example.test/verify'
				}
			)
		).rejects.toBeInstanceOf(CapabilityConfigurationError);
		await expect(
			sendResetPasswordEmail._handler(
				{},
				{
					email: credentials.email,
					resetUrl: 'https://example.test/reset',
					userId: 'user_1'
				}
			)
		).rejects.toBeInstanceOf(CapabilityConfigurationError);

		const callbackUser = {
			id: 'user_1',
			email: credentials.email,
			name: credentials.name
		} as never;
		await expect(
			options.emailVerification.sendVerificationEmail({
				user: callbackUser,
				url: 'https://example.test/verify',
				token: 'token'
			})
		).rejects.toBeInstanceOf(CapabilityConfigurationError);
		await expect(
			options.emailAndPassword.sendResetPassword({
				user: callbackUser,
				url: 'https://example.test/reset',
				token: 'token'
			})
		).rejects.toBeInstanceOf(CapabilityConfigurationError);

		const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
		await expect(
			auth.api.sendVerificationEmail({ body: { email: credentials.email } })
		).rejects.toThrow();
		const resetResult = await auth.api.requestPasswordReset({
			body: { email: credentials.email, redirectTo: '/reset-password' }
		});

		expect(resetResult.status).toBe(true);
		await vi.waitFor(() => expect(errorLog).toHaveBeenCalled());
		expect(enqueue).not.toHaveBeenCalled();
	});
});
