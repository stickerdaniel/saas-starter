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
			emailVerification: options.emailVerification,
			hooks: options.hooks
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

		await expect(
			auth.api.sendVerificationEmail({ body: { email: credentials.email } })
		).rejects.toThrow();
		await expect(
			auth.api.requestPasswordReset({
				body: { email: credentials.email, redirectTo: '/reset-password' }
			})
		).rejects.toThrow();
		expect(enqueue).not.toHaveBeenCalled();
	});

	it('lets the test profile create E2E users without enabling or calling email delivery', async () => {
		vi.stubEnv('SITE_URL', 'https://example.test');
		vi.stubEnv('BETTER_AUTH_SECRET', 'test-secret-that-is-long-enough-for-signing');
		vi.stubEnv('CAPABILITY_PROFILE', 'test');

		const [{ createAuthOptions }, sendModule, resendModule] = await Promise.all([
			import('../auth'),
			import('../emails/send'),
			import('../emails/resend')
		]);
		const sendVerificationEmail = sendModule.sendVerificationEmail as unknown as RegisteredMutation;
		const enqueue = vi.spyOn(resendModule.resend, 'sendEmail');
		const mutationCtx = { runQuery: vi.fn() };
		const runMutation = vi.fn((_reference: unknown, args: Record<string, unknown>) =>
			sendVerificationEmail._handler(mutationCtx, args)
		);
		const options = createAuthOptions({ runMutation } as never);
		const database = { user: [], session: [], account: [], verification: [] };
		const auth = betterAuth({
			baseURL: 'https://example.test',
			secret: 'test-secret-that-is-long-enough-for-signing',
			database: memoryAdapter(database),
			emailAndPassword: options.emailAndPassword,
			emailVerification: options.emailVerification,
			hooks: options.hooks
		});

		await expect(
			auth.api.signUpEmail({
				body: { ...credentials, email: 'local-user@e2e.example.com' }
			})
		).resolves.toBeDefined();
		expect(database.user).toHaveLength(1);
		expect(runMutation).toHaveBeenCalledOnce();
		expect(enqueue).not.toHaveBeenCalled();
		expect(mutationCtx.runQuery).not.toHaveBeenCalled();

		await expect(
			auth.api.signUpEmail({ body: { ...credentials, email: 'real-user@example.com' } })
		).rejects.toBeInstanceOf(Error);
		expect(database.user).toHaveLength(1);
	});

	it('rejects malformed email routes before Better Auth writes state', async () => {
		vi.stubEnv('SITE_URL', 'https://example.test');
		vi.stubEnv('BETTER_AUTH_SECRET', 'test-secret-that-is-long-enough-for-signing');
		vi.stubEnv('RESEND_API_KEY', 'configured-resend-key');
		vi.stubEnv('AUTH_EMAIL', 'malformed-sender');
		vi.stubEnv('EMAIL_ASSET_URL', 'https://assets.example.com');

		const [{ createAuthOptions }, resendModule] = await Promise.all([
			import('../auth'),
			import('../emails/resend')
		]);
		const enqueue = vi.spyOn(resendModule.resend, 'sendEmail');
		const runMutation = vi.fn().mockResolvedValue(null);
		const options = createAuthOptions({ runMutation } as never);
		const existingUser = {
			id: 'existing-user',
			email: 'known@example.test',
			name: 'Known User',
			emailVerified: true,
			createdAt: new Date('2026-01-01T00:00:00.000Z'),
			updatedAt: new Date('2026-01-01T00:00:00.000Z')
		};
		const database = {
			user: [existingUser] as Array<Record<string, unknown>>,
			session: [] as Array<Record<string, unknown>>,
			account: [] as Array<Record<string, unknown>>,
			verification: [] as Array<Record<string, unknown>>
		};
		const auth = betterAuth({
			baseURL: 'https://example.test',
			secret: 'test-secret-that-is-long-enough-for-signing',
			database: memoryAdapter(database),
			emailAndPassword: options.emailAndPassword,
			emailVerification: options.emailVerification,
			hooks: options.hooks
		});

		await expect(auth.api.signUpEmail({ body: credentials })).rejects.toThrow();
		await expect(
			auth.api.requestPasswordReset({
				body: { email: existingUser.email, redirectTo: '/reset-password' }
			})
		).rejects.toThrow();
		await expect(
			auth.api.sendVerificationEmail({ body: { email: credentials.email } })
		).rejects.toThrow();

		expect(database.user).toEqual([existingUser]);
		expect(database.account).toHaveLength(0);
		expect(database.verification).toHaveLength(0);
		expect(database.session).toHaveLength(0);
		expect(runMutation).not.toHaveBeenCalled();
		expect(enqueue).not.toHaveBeenCalled();
	});

	it('keeps ready password reset responses enumeration-safe', async () => {
		vi.stubEnv('SITE_URL', 'https://example.test');
		vi.stubEnv('BETTER_AUTH_SECRET', 'test-secret-that-is-long-enough-for-signing');
		vi.stubEnv('RESEND_API_KEY', 'configured-resend-key');
		vi.stubEnv('AUTH_EMAIL', 'sender@example.com');
		vi.stubEnv('EMAIL_ASSET_URL', 'https://assets.example.com');

		const { createAuthOptions } = await import('../auth');
		const runMutation = vi.fn().mockResolvedValue(null);
		const options = createAuthOptions({ runMutation } as never);
		const auth = betterAuth({
			baseURL: 'https://example.test',
			secret: 'test-secret-that-is-long-enough-for-signing',
			database: memoryAdapter({ user: [], session: [], account: [], verification: [] }),
			emailAndPassword: options.emailAndPassword,
			emailVerification: options.emailVerification,
			hooks: options.hooks
		});

		const unknown = await auth.api.requestPasswordReset({
			body: { email: 'unknown@example.test', redirectTo: '/reset-password' }
		});
		await auth.api.signUpEmail({ body: credentials });
		const known = await auth.api.requestPasswordReset({
			body: { email: credentials.email, redirectTo: '/reset-password' }
		});

		expect(unknown).toEqual(known);
		expect(known.status).toBe(true);
	});
});
