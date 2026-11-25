import { FunctionImpl, GroupImpl } from '@confect/server';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import { components } from '../../convex/_generated/api';
import databaseSchema from '../_generated/schema';
import { MutationCtx } from '../_generated/services';
import cleanup from './cleanup.spec';

export default GroupImpl.make(databaseSchema, cleanup).pipe(
	Layer.provide([
		FunctionImpl.make(databaseSchema, cleanup, 'cleanupExpiredFiles', ({ limit }) =>
			Effect.gen(function* () {
				const ctx = yield* MutationCtx;
				return yield* Effect.promise(() =>
					ctx.runMutation(components.convexFilesControl.cleanUp.cleanupExpired, { limit })
				);
			})
		)
	]),
	GroupImpl.finalize
);
