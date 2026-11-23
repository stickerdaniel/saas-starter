import type { GenericCtx } from '@convex-dev/better-auth';
import { MiddlewareImpl } from '@confect/server';
import * as Effect from 'effect/Effect';
import type { DataModel } from '../../convex/_generated/dataModel';
import databaseSchema from '../_generated/schema';
import { MutationCtx, QueryCtx } from '../_generated/services';
import { authComponent } from '../authServer';
import { Unauthenticated } from '../../effect/errors';
import RequireUser, { CurrentUser } from './RequireUser.spec';

export const signedInUser = (ctx: GenericCtx<DataModel>) =>
	Effect.promise(() => authComponent.safeGetAuthUser(ctx)).pipe(
		Effect.flatMap((user) => (user ? Effect.succeed(user) : Effect.fail(new Unauthenticated())))
	);

export default MiddlewareImpl.makeByFunctionType(databaseSchema, RequireUser, {
	query: (effect) => Effect.provideServiceEffect(effect, CurrentUser, QueryCtx.use(signedInUser)),
	mutation: (effect) =>
		Effect.provideServiceEffect(effect, CurrentUser, MutationCtx.use(signedInUser))
});
