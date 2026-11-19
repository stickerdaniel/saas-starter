/**
 * T0 spike: the authed and admin checks of `functions.ts` as Confect middleware.
 * Confect registers through `queryGeneric`/`mutationGeneric`, so it cannot wrap
 * the `convex-helpers` builders; the same checks run here, before the handler.
 * A refusal is the same `ConvexError` the builders throw, rethrown as a defect,
 * which Confect passes through unchanged.
 */
import { MiddlewareSpec } from '@confect/core';
import { MiddlewareImpl } from '@confect/server';
import * as Context from 'effect/Context';
import * as Effect from 'effect/Effect';
import { ADMIN_ERROR_CODES, createAdminError } from '../convex/admin/errors';
import type { BetterAuthUser } from '../convex/admin/types';
import type { QueryCtx as AppQueryCtx } from '../convex/_generated/server';
import { authComponent } from '../convex/auth';
import databaseSchema from './schema';
import { MutationCtx, QueryCtx } from './services';

export class CurrentUser extends Context.Service<CurrentUser, BetterAuthUser>()(
	'confect-spike/CurrentUser'
) {}

/**
 * Confect types `ctx` with its own data model; Better Auth reads only
 * `ctx.auth` and `ctx.runQuery`, which both models share.
 */
const authUser = (ctx: object) =>
	Effect.promise(() => authComponent.getAuthUser(ctx as AppQueryCtx) as Promise<BetterAuthUser>);

const adminUser = (ctx: object) =>
	Effect.flatMap(authUser(ctx), (user) =>
		user.role === 'admin'
			? Effect.succeed(user)
			: Effect.die(createAdminError(ADMIN_ERROR_CODES.accessRequired))
	);

export class RequireUser extends MiddlewareSpec.MiddlewareSpec<
	RequireUser,
	{ provides: CurrentUser }
>()('RequireUser', { functionTypes: { query: true, mutation: true, action: false } }) {}

export class RequireAdmin extends MiddlewareSpec.MiddlewareSpec<
	RequireAdmin,
	{ provides: CurrentUser }
>()('RequireAdmin', { functionTypes: { query: true, mutation: true, action: false } }) {}

export const RequireUserImpl = MiddlewareImpl.makeByFunctionType(databaseSchema, RequireUser, {
	query: (effect) => Effect.provideServiceEffect(effect, CurrentUser, QueryCtx.use(authUser)),
	mutation: (effect) => Effect.provideServiceEffect(effect, CurrentUser, MutationCtx.use(authUser))
});

export const RequireAdminImpl = MiddlewareImpl.makeByFunctionType(databaseSchema, RequireAdmin, {
	query: (effect) => Effect.provideServiceEffect(effect, CurrentUser, QueryCtx.use(adminUser)),
	mutation: (effect) => Effect.provideServiceEffect(effect, CurrentUser, MutationCtx.use(adminUser))
});
