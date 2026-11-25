// @vitest-environment node
/// <reference types="vite/client" />
import { APIError } from 'better-auth/api';
import { convexTest } from 'convex-test';
import rateLimiterSchema from '../../../../node_modules/@convex-dev/rate-limiter/dist/component/schema.js';
import { ConvexError } from 'convex/values';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, components } from '../../convex/_generated/api';
import schema from '../../convex/schema';
import authSchema from '../../convex-components/betterAuth/schema';
import { authComponent, createAuth } from '../authServer';
import { convexModules, preloadModules } from '../convexTest.modules';

const betterAuthModules = await preloadModules(
	import.meta.glob('../../convex-components/betterAuth/**/*.ts')
);
const rateLimiterModules = await preloadModules(
	import.meta.glob('../../../../node_modules/@convex-dev/rate-limiter/dist/component/**/*.js')
);

const DAY = 24 * 60 * 60 * 1000;
const NUDGE_DEFERRAL_MS = 30 * DAY;
const STRONG_PASSWORD = 'Correct-Horse-9-Battery';
const SET_PASSWORD_ATTEMPTS_PER_HOUR = 5;

const harness = () => {
	const t = convexTest(schema, convexModules);
	t.registerComponent('betterAuth', authSchema, betterAuthModules);
	t.registerComponent('rateLimiter', rateLimiterSchema, rateLimiterModules);
	return t;
};
type Harness = ReturnType<typeof harness>;

async function signIn(
	t: Harness,
	email: string,
	session: { age?: number; impersonatedBy?: string } = {}
) {
	const now = Date.now();
	const createdAt = now - (session.age ?? 0);
	const user = (await t.mutation(components.betterAuth.adapter.create, {
		input: {
			model: 'user',
			data: {
				name: 'Ada',
				email,
				emailVerified: true,
				role: 'user',
				createdAt: now,
				updatedAt: now
			}
		}
	})) as { _id: string };
	const created = (await t.mutation(components.betterAuth.adapter.create, {
		input: {
			model: 'session',
			data: {
				userId: user._id,
				token: crypto.randomUUID(),
				expiresAt: now + DAY,
				createdAt,
				updatedAt: createdAt,
				impersonatedBy: session.impersonatedBy
			}
		}
	})) as { _id: string };
	return {
		userId: user._id,
		caller: t.withIdentity({ subject: user._id, sessionId: created._id })
	};
}

async function failure(call: Promise<unknown>) {
	const error = await call.then(
		() => undefined,
		(reason: unknown) => reason
	);
	if (!(error instanceof ConvexError)) throw new Error(`Expected a ConvexError, got ${error}`);
	return error.data;
}

const accounts = async (t: Harness, userId: string) =>
	(
		await t.query(components.betterAuth.adapter.findMany, {
			model: 'account',
			where: [{ field: 'userId', operator: 'eq', value: userId }],
			paginationOpts: { cursor: null, numItems: 10 }
		})
	).page;

const dismissals = (t: Harness) =>
	t.run(async (ctx) => await ctx.db.query('passkeyNudgeDismissals').take(10));

type BetterAuth = Awaited<ReturnType<typeof authComponent.getAuth<typeof createAuth>>>['auth'];

const withBetterAuth = (change: (auth: BetterAuth) => void) => {
	const getAuth = authComponent.getAuth.bind(authComponent);
	return vi.spyOn(authComponent, 'getAuth').mockImplementation(async (_createAuth, ctx) => {
		const real = await getAuth(createAuth, ctx);
		change(real.auth);
		return real;
	});
};

const rejectSetPassword = (code: string) =>
	withBetterAuth((auth) => {
		vi.spyOn(auth.api, 'setPassword').mockRejectedValue(
			new APIError('BAD_REQUEST', { code, message: code })
		);
	});

beforeEach(() => {
	vi.stubEnv('SITE_URL', 'https://example.test');
	vi.stubEnv('BETTER_AUTH_SECRET', 'test-secret-test-secret-test-secret');
});

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllEnvs();
});

describe('users access', () => {
	it('refuses every users function without a session and writes nothing', async () => {
		const t = harness();
		await expect(failure(t.query(api.users.viewer, {}))).resolves.toBe('Unauthenticated');
		await expect(failure(t.query(api.users.hasPassword, {}))).resolves.toBe('Unauthenticated');
		await expect(failure(t.query(api.users.getPasskeyNudgeDismissal, {}))).resolves.toBe(
			'Unauthenticated'
		);
		await expect(failure(t.mutation(api.users.dismissPasskeyNudge, {}))).resolves.toBe(
			'Unauthenticated'
		);
		await expect(
			failure(t.mutation(api.users.setPassword, { newPassword: STRONG_PASSWORD }))
		).resolves.toBe('Unauthenticated');
		expect(await dismissals(t)).toEqual([]);
		const allAccounts = await t.query(components.betterAuth.adapter.findMany, {
			model: 'account',
			paginationOpts: { cursor: null, numItems: 10 }
		});
		expect(allAccounts.page).toEqual([]);
	});
});

describe('viewer', () => {
	it("returns the caller's own user", async () => {
		const t = harness();
		const { caller, userId } = await signIn(t, 'viewer@example.com');
		await signIn(t, 'other@example.com');
		await expect(caller.query(api.users.viewer, {})).resolves.toMatchObject({
			_id: userId,
			email: 'viewer@example.com',
			name: 'Ada',
			role: 'user'
		});
	});
});

describe('passkey nudge', () => {
	it('defers the nudge for 30 days and keeps one row per user', async () => {
		const t = harness();
		const ada = await signIn(t, 'ada@example.com');
		const bob = await signIn(t, 'bob@example.com');
		await expect(ada.caller.query(api.users.getPasskeyNudgeDismissal, {})).resolves.toBe(0);

		const before = Date.now();
		await expect(ada.caller.mutation(api.users.dismissPasskeyNudge, {})).resolves.toBeNull();
		await ada.caller.mutation(api.users.dismissPasskeyNudge, {});

		const deferredUntil = await ada.caller.query(api.users.getPasskeyNudgeDismissal, {});
		expect(deferredUntil).toBeGreaterThanOrEqual(before + NUDGE_DEFERRAL_MS);
		expect(deferredUntil).toBeLessThanOrEqual(Date.now() + NUDGE_DEFERRAL_MS);
		await expect(bob.caller.query(api.users.getPasskeyNudgeDismissal, {})).resolves.toBe(0);
		expect(await dismissals(t)).toEqual([
			expect.objectContaining({ userId: ada.userId, deferredUntil })
		]);
	});
});

describe('setPassword', { timeout: 30_000 }, () => {
	it('links a credential account once and then reports the password as set', async () => {
		const t = harness();
		const { caller, userId } = await signIn(t, 'strong@example.com');
		await expect(caller.query(api.users.hasPassword, {})).resolves.toBe(false);

		await expect(
			caller.mutation(api.users.setPassword, { newPassword: STRONG_PASSWORD })
		).resolves.toEqual({ ok: true });

		await expect(caller.query(api.users.hasPassword, {})).resolves.toBe(true);
		for (let i = 0; i < SET_PASSWORD_ATTEMPTS_PER_HOUR; i++) {
			await expect(
				caller.mutation(api.users.setPassword, { newPassword: STRONG_PASSWORD })
			).resolves.toEqual({ ok: false, code: 'PASSWORD_ALREADY_SET' });
		}
		expect(await accounts(t, userId)).toHaveLength(1);
	});

	it.each([
		['a weak password', 'short', 'PASSWORD_TOO_WEAK'],
		['an overlong password', `Aa1${'x'.repeat(300)}`, 'PASSWORD_TOO_LONG']
	])('rejects %s before the limit and writes nothing', async (_name, newPassword, code) => {
		const t = harness();
		const { caller, userId } = await signIn(t, 'weak@example.com');
		for (let i = 0; i <= SET_PASSWORD_ATTEMPTS_PER_HOUR; i++) {
			await expect(caller.mutation(api.users.setPassword, { newPassword })).resolves.toEqual({
				ok: false,
				code
			});
		}
		expect(await accounts(t, userId)).toEqual([]);
	});

	it('refuses a stale session and an impersonation session', async () => {
		const t = harness();
		const stale = await signIn(t, 'stale@example.com', { age: 2 * DAY });
		await expect(
			stale.caller.mutation(api.users.setPassword, { newPassword: STRONG_PASSWORD })
		).resolves.toEqual({ ok: false, code: 'SESSION_NOT_FRESH' });

		const impersonated = await signIn(t, 'target@example.com', { impersonatedBy: 'admin_1' });
		await expect(
			impersonated.caller.mutation(api.users.setPassword, { newPassword: STRONG_PASSWORD })
		).resolves.toEqual({ ok: false, code: 'IMPERSONATION_NOT_ALLOWED' });
		expect(await accounts(t, stale.userId)).toEqual([]);
		expect(await accounts(t, impersonated.userId)).toEqual([]);
	});

	it('refuses a session Better Auth no longer accepts', async () => {
		const t = harness();
		const { caller, userId } = await signIn(t, 'expired@example.com');
		withBetterAuth((auth) => {
			vi.spyOn(auth.api, 'getSession').mockResolvedValue(null);
		});
		await expect(
			caller.mutation(api.users.setPassword, { newPassword: STRONG_PASSWORD })
		).resolves.toEqual({ ok: false, code: 'SESSION_NOT_FRESH' });
		expect(await accounts(t, userId)).toEqual([]);
	});

	it('refuses a credential row without a password hash', async () => {
		const t = harness();
		const { caller, userId } = await signIn(t, 'unusable@example.com');
		await t.mutation(components.betterAuth.adapter.create, {
			input: {
				model: 'account',
				data: {
					accountId: userId,
					providerId: 'credential',
					userId,
					createdAt: Date.now(),
					updatedAt: Date.now()
				}
			}
		});
		await expect(
			caller.mutation(api.users.setPassword, { newPassword: STRONG_PASSWORD })
		).resolves.toEqual({ ok: false, code: 'CREDENTIAL_ACCOUNT_UNUSABLE' });
		await expect(caller.query(api.users.hasPassword, {})).resolves.toBe(false);
	});

	it('returns an expected Better Auth refusal and counts it against the limit', async () => {
		const t = harness();
		const { caller } = await signIn(t, 'limited@example.com');
		rejectSetPassword('PASSWORD_TOO_SHORT');
		for (let i = 0; i < SET_PASSWORD_ATTEMPTS_PER_HOUR; i++) {
			await expect(
				caller.mutation(api.users.setPassword, { newPassword: STRONG_PASSWORD })
			).resolves.toEqual({ ok: false, code: 'PASSWORD_TOO_SHORT' });
		}
		await expect(
			caller.mutation(api.users.setPassword, { newPassword: STRONG_PASSWORD })
		).resolves.toEqual({ ok: false, code: 'RATE_LIMITED', retryAfter: expect.any(Number) });
	});

	it('fails on an unexpected Better Auth code with its code and keeps no attempt', async () => {
		const t = harness();
		const { caller, userId } = await signIn(t, 'fault@example.com');
		const spy = rejectSetPassword('FAILED_TO_CREATE_ACCOUNT');
		for (let i = 0; i <= SET_PASSWORD_ATTEMPTS_PER_HOUR; i++) {
			await expect(
				failure(caller.mutation(api.users.setPassword, { newPassword: STRONG_PASSWORD }))
			).resolves.toEqual({ code: 'FAILED_TO_CREATE_ACCOUNT' });
		}
		spy.mockRestore();

		await expect(
			caller.mutation(api.users.setPassword, { newPassword: STRONG_PASSWORD })
		).resolves.toEqual({ ok: true });
		expect(await accounts(t, userId)).toHaveLength(1);
	});
});
