/** T0 spike: `admin/mutations.setUserRole` on Confect, with its refusals declared. */
import { FunctionSpec, GroupSpec } from '@confect/core';
import {
	ConvexFunctionDefinitions,
	FunctionImpl,
	GroupImpl,
	RegisteredConvexFunction,
	type RegisteredFunctions
} from '@confect/server';
import * as Clock from 'effect/Clock';
import * as Data from 'effect/Data';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import * as Schema from 'effect/Schema';
import * as SchemaTransformation from 'effect/SchemaTransformation';
import { components } from '../_generated/api';
import type { MutationCtx as AppMutationCtx } from '../_generated/server';
import { ADMIN_ERROR_CODES, type AdminErrorCode } from '../admin/errors';
import { incrementCounter } from '../admin/counters';
import {
	deactivateAdminPreferencesHelper,
	syncAdminPreferences
} from '../admin/notificationPreferences/helpers';
import type { BetterAuthUser } from '../admin/types';
import { CurrentUser, RequireAdmin, RequireAdminImpl } from '../../confect/auth';
import databaseSchema from '../../confect/schema';
import { MutationCtx } from '../../confect/services';

export class AdminRefusal extends Data.TaggedError('AdminRefusal')<{
	readonly code: AdminErrorCode;
}> {}

/**
 * The wire form is the existing `{ code }`, not the `{ _tag, code }` a
 * `Schema.TaggedError` encodes to, so the client reads the same `data`.
 */
const AdminRefusalWire = Schema.Struct({ code: Schema.String }).pipe(
	Schema.decodeTo(
		Schema.instanceOf(AdminRefusal),
		SchemaTransformation.transform({
			decode: ({ code }) => new AdminRefusal({ code: code as AdminErrorCode }),
			encode: (error) => ({ code: error.code })
		})
	)
);

const spec = GroupSpec.make().addFunction(
	FunctionSpec.publicMutation({
		name: 'setUserRole',
		args: () => ({ userId: Schema.String, role: Schema.Literals(['user', 'admin']) }),
		returns: () => Schema.Struct({ success: Schema.Boolean }),
		error: () => AdminRefusalWire
	}).middleware(RequireAdmin)
);

const setUserRoleImpl = FunctionImpl.make(databaseSchema, spec, 'setUserRole', (args) =>
	Effect.gen(function* () {
		const actor = yield* CurrentUser;
		// Confect types `ctx` with its partial data model; the helpers take the app's.
		const ctx = (yield* MutationCtx) as unknown as AppMutationCtx;
		if (actor._id === args.userId) {
			return yield* new AdminRefusal({ code: ADMIN_ERROR_CODES.cannotChangeOwnRole });
		}
		const user = (yield* Effect.promise(() =>
			ctx.runQuery(components.betterAuth.adapter.findOne, {
				model: 'user',
				where: [{ field: '_id', operator: 'eq', value: args.userId }]
			})
		)) as BetterAuthUser | null;
		if (!user) return yield* new AdminRefusal({ code: ADMIN_ERROR_CODES.userNotFound });

		const wasAdmin = user.role === 'admin';
		const isAdmin = args.role === 'admin';
		if (wasAdmin && !isAdmin) {
			const admins = yield* Effect.promise(() =>
				ctx.runQuery(components.betterAuth.adapter.findMany, {
					model: 'user',
					where: [{ field: 'role', operator: 'eq', value: 'admin' }],
					paginationOpts: { cursor: null, numItems: 2 }
				})
			);
			if (admins.page.length < 2) {
				return yield* new AdminRefusal({ code: ADMIN_ERROR_CODES.lastAdmin });
			}
		}
		yield* Effect.promise(() =>
			ctx.runMutation(components.betterAuth.adapter.updateOne, {
				input: {
					model: 'user',
					where: [{ field: '_id', operator: 'eq', value: args.userId }],
					update: { role: args.role }
				}
			})
		);
		if (wasAdmin !== isAdmin) {
			yield* Effect.promise(() => incrementCounter(ctx, 'adminCount', isAdmin ? 1 : -1));
		}
		if (!wasAdmin && isAdmin) {
			yield* Effect.promise(() =>
				syncAdminPreferences(ctx, { userId: args.userId, email: user.email })
			);
		} else if (wasAdmin && !isAdmin) {
			yield* Effect.promise(() => deactivateAdminPreferencesHelper(ctx, args.userId));
		}
		const timestamp = yield* Clock.currentTimeMillis;
		yield* Effect.promise(() =>
			ctx.db.insert('adminAuditLogs', {
				adminUserId: actor._id,
				action: 'set_role',
				targetUserId: args.userId,
				metadata: { newRole: args.role, previousRole: user.role ?? 'user' },
				timestamp
			})
		);
		return { success: true };
	})
);

const definitions = ConvexFunctionDefinitions.buildForGroup<typeof spec>(
	databaseSchema,
	GroupImpl.make(databaseSchema, spec).pipe(
		Layer.provide(setUserRoleImpl),
		Layer.provide(RequireAdminImpl),
		GroupImpl.finalize
	)
);
type Registered = RegisteredFunctions.RegisteredFunctionsForGroupSpec<typeof spec>;

export const setUserRole = RegisteredConvexFunction.register(
	definitions.setUserRole
) as Registered['setUserRole'];
