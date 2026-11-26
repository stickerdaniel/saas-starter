// @vitest-environment node
/// <reference types="vite/client" />
import { FunctionSpec, GroupSpec } from '@confect/core';
import { FunctionImpl, GroupImpl, RegisteredFunctions } from '@confect/server';
import { convexTest } from 'convex-test';
import { makeFunctionReference } from 'convex/server';
import { ConvexError, type Value } from 'convex/values';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import * as Option from 'effect/Option';
import * as Schema from 'effect/Schema';
import { describe, expect, it } from 'vitest';
import { components } from '../../convex/_generated/api';
import schema from '../../convex/schema';
import authSchema from '../../convex-components/betterAuth/schema';
import { getAuthErrorKey } from '../../utils/auth-messages';
import { getConvexErrorCode, getConvexErrorData } from '../../utils/convex-errors';
import databaseSchema from '../_generated/schema';
import { ADMIN_ERROR_CODES, createAdminError } from '../admin/errors';
import {
	NOTIFICATION_EMAIL_ALREADY_EXISTS,
	NOTIFICATION_PREFERENCE_ERROR_CODES,
	createNotificationPreferenceError
} from '../admin/notificationPreferences/errors';
import { convexModules, preloadModules } from '../convexTest.modules';
import {
	AUTH_REFUSAL_CODES,
	AdminRefusalCodec,
	AuthRefusalCodec,
	FileRefusalCodec,
	NotificationPreferenceRefusalCodec,
	RateLimitedCodec,
	SupportRefusalCodec
} from '../errorCodecs';
import { FILE_ERROR_CODES, createFileError } from '../files/errors';
import { SUPPORT_ERROR_CODES, createSupportError } from '../support/errors';
import { createRateLimitError } from '../support/types';
import RequireAdminImpl from './RequireAdmin.impl';
import RequireAdmin from './RequireAdmin.spec';
import RequireUserImpl from './RequireUser.impl';
import RequireUser, { CurrentUser } from './RequireUser.spec';
import VisitorAccessImpl from './VisitorAccess.impl';
import VisitorAccess, { SupportOwner } from './VisitorAccess.spec';

const userGroup = GroupSpec.make()
	.middleware(RequireUser)
	.addFunction(FunctionSpec.publicQuery({ name: 'whoami', returns: () => Schema.String }))
	.addFunction(FunctionSpec.publicMutation({ name: 'touch', returns: () => Schema.String }))
	.addFunction(FunctionSpec.publicQuery({ name: 'marked', returns: () => Schema.String }));

const handled: string[] = [];

const childGroup = GroupSpec.make().addFunction(
	FunctionSpec.publicQuery({ name: 'open', returns: () => Schema.String })
);

const adminGroup = GroupSpec.make()
	.middleware(RequireAdmin)
	.addFunction(FunctionSpec.publicMutation({ name: 'whoami', returns: () => Schema.String }));

const visitorGroup = GroupSpec.make()
	.middleware(VisitorAccess)
	.addFunction(
		FunctionSpec.publicQuery({
			name: 'owner',
			args: () => ({ anonymousUserId: Schema.optionalKey(Schema.String) }),
			returns: () => Schema.String
		})
	);

const refusal = <const Name extends string, Codec extends Schema.Codec<object, object>>(
	name: Name,
	codec: Codec
) =>
	FunctionSpec.publicMutation({
		name,
		args: () => ({ refusal: codec }),
		returns: () => Schema.Null,
		error: () => codec
	});

const wireGroup = GroupSpec.make()
	.addFunction(refusal('admin', AdminRefusalCodec))
	.addFunction(refusal('rateLimited', RateLimitedCodec))
	.addFunction(refusal('auth', AuthRefusalCodec))
	.addFunction(refusal('file', FileRefusalCodec))
	.addFunction(refusal('notificationPreference', NotificationPreferenceRefusalCodec))
	.addFunction(refusal('support', SupportRefusalCodec));

const modules = {
	...convexModules,
	'../convex/policyProbe/user.ts': async () =>
		RegisteredFunctions.buildForGroup<typeof userGroup>(
			databaseSchema,
			GroupImpl.make(databaseSchema, userGroup).pipe(
				Layer.provide([
					FunctionImpl.make(databaseSchema, userGroup, 'whoami', () =>
						Effect.gen(function* () {
							return (yield* CurrentUser)._id;
						})
					),
					FunctionImpl.make(databaseSchema, userGroup, 'touch', () =>
						Effect.gen(function* () {
							return (yield* CurrentUser)._id;
						})
					),
					FunctionImpl.make(databaseSchema, userGroup, 'marked', () =>
						Effect.gen(function* () {
							handled.push('marked');
							return (yield* CurrentUser)._id;
						})
					)
				]),
				Layer.provide(RequireUserImpl),
				GroupImpl.finalize
			)
		),
	'../convex/policyProbe/user/child.ts': async () =>
		RegisteredFunctions.buildForGroup<typeof childGroup>(
			databaseSchema,
			GroupImpl.make(databaseSchema, childGroup).pipe(
				Layer.provide(
					FunctionImpl.make(databaseSchema, childGroup, 'open', () =>
						Effect.gen(function* () {
							return yield* Effect.succeed('open');
						})
					)
				),
				GroupImpl.finalize
			)
		),
	'../convex/policyProbe/admin.ts': async () =>
		RegisteredFunctions.buildForGroup<typeof adminGroup>(
			databaseSchema,
			GroupImpl.make(databaseSchema, adminGroup).pipe(
				Layer.provide(
					FunctionImpl.make(databaseSchema, adminGroup, 'whoami', () =>
						Effect.gen(function* () {
							return (yield* CurrentUser)._id;
						})
					)
				),
				Layer.provide(RequireAdminImpl),
				GroupImpl.finalize
			)
		),
	'../convex/policyProbe/visitor.ts': async () =>
		RegisteredFunctions.buildForGroup<typeof visitorGroup>(
			databaseSchema,
			GroupImpl.make(databaseSchema, visitorGroup).pipe(
				Layer.provide(
					FunctionImpl.make(databaseSchema, visitorGroup, 'owner', () =>
						Effect.gen(function* () {
							return Option.match(yield* SupportOwner, {
								onNone: () => 'none',
								onSome: (owner) => owner.ownerId
							});
						})
					)
				),
				Layer.provide(VisitorAccessImpl),
				GroupImpl.finalize
			)
		),
	'../convex/policyProbe/wire.ts': async () =>
		RegisteredFunctions.buildForGroup<typeof wireGroup>(
			databaseSchema,
			GroupImpl.make(databaseSchema, wireGroup).pipe(
				Layer.provide([
					FunctionImpl.make(databaseSchema, wireGroup, 'admin', ({ refusal }) =>
						Effect.gen(function* () {
							return yield* Effect.fail(refusal);
						})
					),
					FunctionImpl.make(databaseSchema, wireGroup, 'rateLimited', ({ refusal }) =>
						Effect.gen(function* () {
							return yield* Effect.fail(refusal);
						})
					),
					FunctionImpl.make(databaseSchema, wireGroup, 'auth', ({ refusal }) =>
						Effect.gen(function* () {
							return yield* Effect.fail(refusal);
						})
					),
					FunctionImpl.make(databaseSchema, wireGroup, 'file', ({ refusal }) =>
						Effect.gen(function* () {
							return yield* Effect.fail(refusal);
						})
					),
					FunctionImpl.make(databaseSchema, wireGroup, 'notificationPreference', ({ refusal }) =>
						Effect.gen(function* () {
							return yield* Effect.fail(refusal);
						})
					),
					FunctionImpl.make(databaseSchema, wireGroup, 'support', ({ refusal }) =>
						Effect.gen(function* () {
							return yield* Effect.fail(refusal);
						})
					)
				]),
				GroupImpl.finalize
			)
		)
};

const betterAuthModules = await preloadModules(
	import.meta.glob('../../convex-components/betterAuth/**/*.ts')
);

const harness = () => {
	const t = convexTest(schema, modules);
	t.registerComponent('betterAuth', authSchema, betterAuthModules);
	return t;
};
type Harness = ReturnType<typeof harness>;

const query = (name: string) => makeFunctionReference<'query', Record<string, Value>, string>(name);
const mutation = (name: string) =>
	makeFunctionReference<'mutation', Record<string, Value>, string | null>(name);

async function signIn(t: Harness, role: 'user' | 'admin', email = `${role}@example.com`) {
	const now = Date.now();
	const user = (await t.mutation(components.betterAuth.adapter.create, {
		input: {
			model: 'user',
			data: {
				name: 'Ada',
				email,
				emailVerified: true,
				role,
				createdAt: now,
				updatedAt: now
			}
		}
	})) as { _id: string };
	const session = (await t.mutation(components.betterAuth.adapter.create, {
		input: {
			model: 'session',
			data: {
				userId: user._id,
				token: crypto.randomUUID(),
				expiresAt: now + 60_000,
				createdAt: now,
				updatedAt: now
			}
		}
	})) as { _id: string };
	return {
		userId: user._id,
		caller: t.withIdentity({ subject: user._id, sessionId: session._id })
	};
}

type Caller = Awaited<ReturnType<typeof signIn>>['caller'];

async function rejection(call: Promise<unknown>) {
	const error = await call.then(
		() => undefined,
		(reason: unknown) => reason
	);
	if (!(error instanceof ConvexError)) throw new Error(`Expected a ConvexError, got ${error}`);
	return error;
}

describe('RequireUser', () => {
	it('refuses a caller without a session with the Unauthenticated string', async () => {
		const error = await rejection(harness().query(query('policyProbe/user:whoami'), {}));
		expect(error.data).toBe('Unauthenticated');
	});

	it('provides the signed-in user as CurrentUser', async () => {
		const t = harness();
		const { userId, caller } = await signIn(t, 'user');
		await expect(caller.query(query('policyProbe/user:whoami'), {})).resolves.toBe(userId);
	});

	it('does not cover a subgroup', async () => {
		await expect(harness().query(query('policyProbe/user/child:open'), {})).resolves.toBe('open');
	});

	it('refuses before the handler runs its first synchronous step', async () => {
		handled.length = 0;
		const t = harness();
		const error = await rejection(t.query(query('policyProbe/user:marked'), {}));
		expect(error.data).toBe('Unauthenticated');
		expect(handled).toEqual([]);
		const { caller } = await signIn(t, 'user');
		await caller.query(query('policyProbe/user:marked'), {});
		expect(handled).toEqual(['marked']);
	});
});

describe('CurrentUser per invocation', () => {
	it.each([
		['query', (caller: Caller) => caller.query(query('policyProbe/user:whoami'), {})],
		['mutation', (caller: Caller) => caller.mutation(mutation('policyProbe/user:touch'), {})]
	])('follows the caller across user A, user B, user A in a %s', async (_kind, call) => {
		const t = harness();
		const a = await signIn(t, 'user', 'a@example.com');
		const b = await signIn(t, 'user', 'b@example.com');
		const seen = [await call(a.caller), await call(b.caller), await call(a.caller)];
		expect(seen).toEqual([a.userId, b.userId, a.userId]);
	});

	it('refuses a caller without a session after a signed-in call', async () => {
		const t = harness();
		const { userId, caller } = await signIn(t, 'user');
		await expect(caller.query(query('policyProbe/user:whoami'), {})).resolves.toBe(userId);
		const error = await rejection(t.query(query('policyProbe/user:whoami'), {}));
		expect(error.data).toBe('Unauthenticated');
	});

	it('refuses a signed-in user after an admin call', async () => {
		const t = harness();
		const admin = await signIn(t, 'admin');
		const user = await signIn(t, 'user');
		await expect(admin.caller.mutation(mutation('policyProbe/admin:whoami'), {})).resolves.toBe(
			admin.userId
		);
		const error = await rejection(user.caller.mutation(mutation('policyProbe/admin:whoami'), {}));
		expect(getConvexErrorCode(error)).toBe('ADMIN_ACCESS_REQUIRED');
	});
});

describe('RequireAdmin', () => {
	it('refuses a caller without a session with the Unauthenticated string', async () => {
		const error = await rejection(harness().mutation(mutation('policyProbe/admin:whoami'), {}));
		expect(error.data).toBe('Unauthenticated');
	});

	it('refuses a signed-in user with the admin access code the admin page reads', async () => {
		const t = harness();
		const { caller } = await signIn(t, 'user');
		const error = await rejection(caller.mutation(mutation('policyProbe/admin:whoami'), {}));
		expect(error.data).toEqual(createAdminError(ADMIN_ERROR_CODES.accessRequired).data);
		expect(getConvexErrorCode(error)).toBe('ADMIN_ACCESS_REQUIRED');
	});

	it('provides the signed-in admin as CurrentUser', async () => {
		const t = harness();
		const { userId, caller } = await signIn(t, 'admin');
		await expect(caller.mutation(mutation('policyProbe/admin:whoami'), {})).resolves.toBe(userId);
	});
});

describe('VisitorAccess', () => {
	it('provides no owner to a caller with neither a session nor an anonymous id', async () => {
		await expect(harness().query(query('policyProbe/visitor:owner'), {})).resolves.toBe('none');
	});

	it('provides no owner for an anonymous id without the anon_ prefix', async () => {
		await expect(
			harness().query(query('policyProbe/visitor:owner'), { anonymousUserId: 'visitor_1' })
		).resolves.toBe('none');
	});

	it('provides an anonymous visitor as SupportOwner', async () => {
		await expect(
			harness().query(query('policyProbe/visitor:owner'), { anonymousUserId: 'anon_1' })
		).resolves.toBe('anon_1');
	});

	it('provides a signed-in user as SupportOwner', async () => {
		const t = harness();
		const { userId, caller } = await signIn(t, 'user');
		await expect(caller.query(query('policyProbe/visitor:owner'), {})).resolves.toBe(userId);
	});

	it('prefers the session over an anonymous id', async () => {
		const t = harness();
		const { userId, caller } = await signIn(t, 'user');
		await expect(
			caller.query(query('policyProbe/visitor:owner'), { anonymousUserId: 'anon_1' })
		).resolves.toBe(userId);
	});
});

const refuse = async (name: string, refusal: Value) =>
	rejection(harness().mutation(mutation(`policyProbe/wire:${name}`), { refusal }));

describe('error codecs on the wire', () => {
	it.each([
		[ADMIN_ERROR_CODES.cannotChangeOwnRole, 'ADMIN_CANNOT_CHANGE_OWN_ROLE'],
		[ADMIN_ERROR_CODES.userNotFound, 'ADMIN_USER_NOT_FOUND'],
		[ADMIN_ERROR_CODES.lastAdmin, 'ADMIN_LAST_ADMIN'],
		[ADMIN_ERROR_CODES.seedAdminExists, 'ADMIN_ALREADY_EXISTS']
	])('sends admin refusal %s as the admin page reads it', async (code, expected) => {
		const error = await refuse('admin', { code });
		expect(error.data).toEqual(createAdminError(code).data);
		expect(getConvexErrorCode(error)).toBe(expected);
	});

	it.each([
		['ADMIN_CANNOT_BAN_SELF', 'auth.messages.admin_cannot_ban_self'],
		['ADMIN_ACTION_NOT_ALLOWED', 'auth.messages.admin_action_not_allowed'],
		['ADMIN_AUTH_ACTION_FAILED', 'auth.messages.admin_action_failed']
	])('sends admin auth refusal %s as the admin page translates it', async (code, key) => {
		const error = await refuse('admin', { code });
		expect(error.data).toEqual(new ConvexError({ code }).data);
		expect(getAuthErrorKey(getConvexErrorData(error))).toBe(key);
	});

	it.each([
		SUPPORT_ERROR_CODES.authenticationRequired,
		SUPPORT_ERROR_CODES.threadNotFound,
		SUPPORT_ERROR_CODES.threadForbidden,
		SUPPORT_ERROR_CODES.anonymousUserInvalid,
		SUPPORT_ERROR_CODES.notificationEmailInvalid
	])('sends support refusal %s as the support helpers do', async (code) => {
		const error = await refuse('support', { code });
		expect(error.data).toEqual(createSupportError(code).data);
	});

	it('sends a rate limit as the chat and support clients read it', async () => {
		const error = await refuse('rateLimited', { code: 'RATE_LIMITED', retryAfter: 4_000 });
		expect(error.data).toEqual(createRateLimitError(4_000).data);
		const data = error.data as { code?: string; retryAfter?: number };
		expect(data.code === 'RATE_LIMITED' && data.retryAfter).toBe(4_000);
		expect(getAuthErrorKey(error.data)).toBe('auth.messages.rate_limited');
	});

	it.each(AUTH_REFUSAL_CODES)(
		'sends auth refusal %s to a branch of the auth messages',
		async (code) => {
			const error = await refuse('auth', { code });
			expect(error.data).toEqual(new ConvexError({ code }).data);
			const carrier = { code: (error.data as { code?: string }).code };
			expect(getAuthErrorKey(carrier, 'fallback')).not.toBe('fallback');
		}
	);

	it('sends the password length refusal as the password settings read it', async () => {
		const error = await refuse('auth', { code: 'PASSWORD_TOO_SHORT' });
		expect(getAuthErrorKey(error.data)).toBe('auth.messages.password_too_short');
	});

	it('rejects an auth code the auth messages do not branch on', async () => {
		expect(() =>
			Schema.decodeUnknownSync(AuthRefusalCodec)({ code: 'NOT_AN_AUTH_CODE' })
		).toThrow();
		await expect(
			harness().mutation(mutation('policyProbe/wire:auth'), {
				refusal: { code: 'NOT_AN_AUTH_CODE' }
			})
		).rejects.toThrow();
	});

	it.each([
		NOTIFICATION_EMAIL_ALREADY_EXISTS,
		...Object.values(NOTIFICATION_PREFERENCE_ERROR_CODES)
	])('sends notification preference refusal %s as the producer does', async (code) => {
		const error = await refuse('notificationPreference', { code });
		expect(error.data).toEqual(createNotificationPreferenceError(code).data);
	});

	it('sends the duplicate recipient refusal to the admin settings email field branch', async () => {
		const error = await refuse('notificationPreference', {
			code: NOTIFICATION_EMAIL_ALREADY_EXISTS
		});
		expect(getConvexErrorCode(error)).toBe(NOTIFICATION_EMAIL_ALREADY_EXISTS);
	});

	it.each([
		createFileError(FILE_ERROR_CODES.tooLarge, { maxBytes: 10, actualBytes: 11 }),
		createFileError(FILE_ERROR_CODES.typeNotAllowed, { allowedTypes: ['image/png'] }),
		createFileError(FILE_ERROR_CODES.typeNotAllowed),
		createFileError(FILE_ERROR_CODES.uploadRateLimited, { retryAfter: 2_000 }),
		createFileError(FILE_ERROR_CODES.previewRateLimited, { retryAfter: 3_000 }),
		createFileError(FILE_ERROR_CODES.metadataLimit, { maxUrls: 100 }),
		createFileError(FILE_ERROR_CODES.fetchFailed),
		createFileError(FILE_ERROR_CODES.storageUnavailable)
	])('sends upload refusal %o as the producer does', async (today) => {
		const error = await refuse('file', today.data);
		expect(error.data).toEqual(today.data);
	});
});
