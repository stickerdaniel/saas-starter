import type { GenericCtx } from '@convex-dev/better-auth';
import { MiddlewareImpl } from '@confect/server';
import * as Effect from 'effect/Effect';
import type { DataModel } from '../../convex/_generated/dataModel';
import databaseSchema from '../_generated/schema';
import { MutationCtx, QueryCtx } from '../_generated/services';
import { AdminAccessRequired } from '../errorCodecs';
import RequireAdmin from './RequireAdmin.spec';
import { signedInUser } from './RequireUser.impl';
import { CurrentUser } from './RequireUser.spec';

const signedInAdmin = (ctx: GenericCtx<DataModel>) =>
	signedInUser(ctx).pipe(
		Effect.filterOrFail(
			(user) => user.role === 'admin',
			() => new AdminAccessRequired()
		)
	);

export default MiddlewareImpl.makeByFunctionType(databaseSchema, RequireAdmin, {
	query: (effect) => Effect.provideServiceEffect(effect, CurrentUser, QueryCtx.use(signedInAdmin)),
	mutation: (effect) =>
		Effect.provideServiceEffect(effect, CurrentUser, MutationCtx.use(signedInAdmin))
});
