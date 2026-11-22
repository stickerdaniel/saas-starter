import type { GenericCtx } from '@convex-dev/better-auth';
import type { DataModel } from '../convex/_generated/dataModel';
import { authComponent } from './authServer';

/** The signed-in user. Throws ConvexError('Unauthenticated') when there is none. */
export const requireAuthUser = (ctx: GenericCtx<DataModel>) => authComponent.getAuthUser(ctx);
