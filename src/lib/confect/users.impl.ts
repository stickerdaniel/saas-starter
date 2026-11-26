import { FunctionImpl, GroupImpl } from '@confect/server';
import { ConvexError } from 'convex/values';
import * as Duration from 'effect/Duration';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import * as Option from 'effect/Option';
import * as Schema from 'effect/Schema';
import * as val from 'valibot';
import type { QueryCtx as ConvexQueryCtx } from '../convex/_generated/server';
import { passwordValidation } from '../schemas/password';
import databaseSchema from './_generated/schema';
import { MutationCtx, QueryCtx } from './_generated/services';
import { authComponent, createAuth } from './authServer';
import { credentialAccounts, hasUsablePassword } from './credentialAccounts';
import RequireUserImpl, { actingUser } from './middleware/RequireUser.impl';
import { CurrentUser } from './middleware/RequireUser.spec';
import { appRateLimiter } from './rateLimit';
import users from './users.spec';

const NUDGE_DEFERRAL = Duration.days(30);

const viewer = Effect.gen(function* () {
	return yield* CurrentUser;
});

const EXPECTED_SET_PASSWORD_CODES: ReadonlySet<string> = new Set([
	'PASSWORD_ALREADY_SET',
	'PASSWORD_TOO_SHORT',
	'PASSWORD_TOO_LONG'
]);

const BetterAuthRejection = Schema.Struct({ body: Schema.Struct({ code: Schema.String }) });

const betterAuthErrorCode = (error: unknown) =>
	Option.match(Schema.decodeUnknownOption(BetterAuthRejection)(error), {
		onNone: () => 'SET_PASSWORD_FAILED',
		onSome: ({ body }) => body.code
	});

const ImpersonatedSession = Schema.Struct({
	session: Schema.Struct({ impersonatedBy: Schema.String })
});

const passkeyNudgeDismissal = (ctx: Pick<ConvexQueryCtx, 'db'>, userId: string) =>
	Effect.promise(() =>
		ctx.db
			.query('passkeyNudgeDismissals')
			.withIndex('by_userId', (q) => q.eq('userId', userId))
			.unique()
	);

export default GroupImpl.make(databaseSchema, users).pipe(
	Layer.provide([
		FunctionImpl.make(databaseSchema, users, 'dismissPasskeyNudge', () =>
			Effect.gen(function* () {
				const { _id: userId } = yield* CurrentUser;
				const ctx = yield* MutationCtx;
				const dismissal = yield* passkeyNudgeDismissal(ctx, userId);
				const deferredUntil = Date.now() + Duration.toMillis(NUDGE_DEFERRAL);
				if (dismissal) {
					yield* Effect.promise(() =>
						ctx.db.patch('passkeyNudgeDismissals', dismissal._id, { deferredUntil })
					);
				} else {
					yield* Effect.promise(() =>
						ctx.db.insert('passkeyNudgeDismissals', { userId, deferredUntil })
					);
				}
				return null;
			})
		),
		FunctionImpl.make(databaseSchema, users, 'getPasskeyNudgeDismissal', () =>
			Effect.gen(function* () {
				const { _id: userId } = yield* CurrentUser;
				const dismissal = yield* passkeyNudgeDismissal(yield* QueryCtx, userId);
				return dismissal?.deferredUntil ?? 0;
			})
		),
		FunctionImpl.make(databaseSchema, users, 'hasPassword', () =>
			Effect.gen(function* () {
				const { _id: userId } = yield* CurrentUser;
				const ctx = yield* QueryCtx;
				return yield* Effect.promise(() => hasUsablePassword(ctx, userId));
			})
		),
		FunctionImpl.make(databaseSchema, users, 'setPassword', ({ newPassword }) =>
			Effect.gen(function* () {
				const { _id: userId } = yield* CurrentUser;
				const ctx = yield* MutationCtx;
				const { auth, headers } = yield* Effect.promise(() =>
					authComponent.getAuth(createAuth, ctx)
				);

				const session = yield* Effect.promise(() => auth.api.getSession({ headers }));
				if (Schema.is(ImpersonatedSession)(session) && session.session.impersonatedBy) {
					return { ok: false, code: 'IMPERSONATION_NOT_ALLOWED' };
				}

				const authCtx = yield* Effect.promise(() => auth.$context);
				const freshAge = authCtx.sessionConfig.freshAge;
				const sessionCreatedAt = session?.session?.createdAt;
				if (!sessionCreatedAt) return { ok: false, code: 'SESSION_NOT_FRESH' };
				if (
					freshAge !== 0 &&
					Date.now() - new Date(sessionCreatedAt).getTime() >= freshAge * 1000
				) {
					return { ok: false, code: 'SESSION_NOT_FRESH' };
				}

				if (!val.safeParse(passwordValidation, newPassword).success) {
					return { ok: false, code: 'PASSWORD_TOO_WEAK' };
				}
				if (newPassword.length > authCtx.password.config.maxPasswordLength) {
					return { ok: false, code: 'PASSWORD_TOO_LONG' };
				}

				const credentials = yield* Effect.promise(() => credentialAccounts(ctx, userId));
				if (credentials.some((account) => account.password)) {
					return { ok: false, code: 'PASSWORD_ALREADY_SET' };
				}
				if (credentials.length > 0) {
					return { ok: false, code: 'CREDENTIAL_ACCOUNT_UNUSABLE' };
				}

				const status = yield* Effect.promise(() =>
					appRateLimiter.limit(ctx, 'setPassword', { key: userId })
				);
				if (!status.ok) {
					return { ok: false, code: 'RATE_LIMITED', retryAfter: status.retryAfter };
				}

				return yield* Effect.tryPromise({
					try: () => auth.api.setPassword({ body: { newPassword }, headers }),
					catch: betterAuthErrorCode
				}).pipe(
					Effect.as({ ok: true }),
					Effect.catch((code) =>
						EXPECTED_SET_PASSWORD_CODES.has(code)
							? Effect.succeed({ ok: false, code })
							: Effect.die(new ConvexError({ code }))
					)
				);
			})
		),
		FunctionImpl.make(databaseSchema, users, 'viewer', () =>
			Effect.gen(function* () {
				return yield* viewer;
			})
		),
		FunctionImpl.make(databaseSchema, users, 'viewerAs', ({ userId }) =>
			Effect.gen(function* () {
				const user = yield* QueryCtx.use(actingUser(userId));
				return yield* Effect.provideService(viewer, CurrentUser, user);
			})
		)
	]),
	Layer.provide(RequireUserImpl),
	GroupImpl.finalize
);
