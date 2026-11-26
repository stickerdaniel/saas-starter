import { FunctionImpl, GroupImpl } from '@confect/server';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import { components } from '../../convex/_generated/api';
import type { MutationCtx as ConvexMutationCtx } from '../../convex/_generated/server';
import databaseSchema from '../_generated/schema';
import { MutationCtx } from '../_generated/services';
import { authComponent, createAuth } from '../authServer';
import { AdminRefusal } from '../errorCodecs';
import RequireAdminImpl from '../middleware/RequireAdmin.impl';
import { CurrentUser } from '../middleware/RequireUser.spec';
import { adminAuthApi, type AdminAuthOperation } from './adminAuthErrors';
import { incrementCounter } from './counters';
import { ADMIN_ERROR_CODES } from './errors';
import mutations from './mutations.spec';
import {
	deactivateAdminPreferencesHelper,
	syncAdminPreferences
} from './notificationPreferences/helpers';
import type { BetterAuthUser } from './types';

type AuditedAction = 'ban_user' | 'unban_user' | 'revoke_sessions';

const withCtx = <A>(run: (ctx: ConvexMutationCtx) => Promise<A>) =>
	MutationCtx.use((ctx) => Effect.promise(() => run(ctx)));

const findUser = (field: '_id' | 'email', value: string) =>
	withCtx(
		(ctx) =>
			ctx.runQuery(components.betterAuth.adapter.findOne, {
				model: 'user',
				where: [{ field, operator: 'eq', value }]
			}) as Promise<BetterAuthUser | null>
	);

const findAdmins = (numItems: number) =>
	withCtx((ctx) =>
		ctx.runQuery(components.betterAuth.adapter.findMany, {
			model: 'user',
			where: [{ field: 'role', operator: 'eq', value: 'admin' }],
			paginationOpts: { cursor: null, numItems }
		})
	);

const setRole = (userId: string, role: 'user' | 'admin') =>
	withCtx((ctx) =>
		ctx.runMutation(components.betterAuth.adapter.updateOne, {
			input: {
				model: 'user',
				where: [{ field: '_id', operator: 'eq', value: userId }],
				update: { role }
			}
		})
	);

const audit = (
	adminUserId: string,
	action: AuditedAction | 'set_role',
	targetUserId: string,
	metadata: { reason: string } | { newRole: string; previousRole: string } | Record<never, never>
) =>
	withCtx((ctx) =>
		ctx.db.insert('adminAuditLogs', {
			adminUserId,
			action,
			targetUserId,
			metadata,
			timestamp: Date.now()
		})
	);

const auditedAuthAction = (
	operation: AdminAuthOperation,
	action: AuditedAction,
	userId: string,
	metadata: { reason: string } | Record<never, never>,
	call: (api: ReturnType<typeof createAuth>['api'], headers: Headers) => Promise<unknown>
) =>
	Effect.gen(function* () {
		const admin = yield* CurrentUser;
		const { auth, headers } = yield* withCtx((ctx) => authComponent.getAuth(createAuth, ctx));
		yield* adminAuthApi(operation, () => call(auth.api, headers));
		yield* audit(admin._id, action, userId, metadata);
		return { success: true };
	});

export default GroupImpl.make(databaseSchema, mutations).pipe(
	Layer.provide([
		FunctionImpl.make(databaseSchema, mutations, 'banUser', ({ userId, reason }) =>
			Effect.gen(function* () {
				return yield* auditedAuthAction(
					'ban_user',
					'ban_user',
					userId,
					{ reason },
					(api, headers) => api.banUser({ body: { userId, banReason: reason }, headers })
				);
			})
		),
		FunctionImpl.make(databaseSchema, mutations, 'unbanUser', ({ userId }) =>
			Effect.gen(function* () {
				return yield* auditedAuthAction('unban_user', 'unban_user', userId, {}, (api, headers) =>
					api.unbanUser({ body: { userId }, headers })
				);
			})
		),
		FunctionImpl.make(databaseSchema, mutations, 'revokeUserSessions', ({ userId }) =>
			Effect.gen(function* () {
				return yield* auditedAuthAction(
					'revoke_user_sessions',
					'revoke_sessions',
					userId,
					{},
					(api, headers) => api.revokeUserSessions({ body: { userId }, headers })
				);
			})
		),
		FunctionImpl.make(databaseSchema, mutations, 'setUserRole', ({ userId, role }) =>
			Effect.gen(function* () {
				const admin = yield* CurrentUser;
				if (admin._id === userId) {
					return yield* Effect.fail(
						new AdminRefusal({ code: ADMIN_ERROR_CODES.cannotChangeOwnRole })
					);
				}
				const user = yield* findUser('_id', userId);
				if (!user) {
					return yield* Effect.fail(new AdminRefusal({ code: ADMIN_ERROR_CODES.userNotFound }));
				}
				const wasAdmin = user.role === 'admin';
				const isAdmin = role === 'admin';
				if (wasAdmin && !isAdmin && (yield* findAdmins(2)).page.length < 2) {
					return yield* Effect.fail(new AdminRefusal({ code: ADMIN_ERROR_CODES.lastAdmin }));
				}
				yield* setRole(userId, role);
				if (wasAdmin !== isAdmin) {
					yield* withCtx((ctx) => incrementCounter(ctx, 'adminCount', isAdmin ? 1 : -1));
				}
				if (!wasAdmin && isAdmin) {
					yield* withCtx((ctx) => syncAdminPreferences(ctx, { userId, email: user.email }));
				} else if (wasAdmin && !isAdmin) {
					yield* withCtx((ctx) => deactivateAdminPreferencesHelper(ctx, userId));
				}
				yield* audit(admin._id, 'set_role', userId, {
					newRole: role,
					previousRole: user.role ?? 'user'
				});
				return { success: true };
			})
		),
		FunctionImpl.make(databaseSchema, mutations, 'seedFirstAdmin', ({ email }) =>
			Effect.gen(function* () {
				if ((yield* findAdmins(1)).page.length > 0) {
					return { success: false, code: ADMIN_ERROR_CODES.seedAdminExists } as const;
				}
				const user = yield* findUser('email', email);
				if (!user) {
					return yield* Effect.fail(new AdminRefusal({ code: ADMIN_ERROR_CODES.userNotFound }));
				}
				yield* setRole(user._id, 'admin');
				yield* withCtx((ctx) => incrementCounter(ctx, 'adminCount', 1));
				yield* withCtx((ctx) => syncAdminPreferences(ctx, { userId: user._id, email: user.email }));
				yield* Effect.log(`User ${email} has been set as admin`);
				return { success: true } as const;
			})
		)
	]),
	Layer.provide(RequireAdminImpl),
	GroupImpl.finalize
);
