import { FunctionImpl, GroupImpl } from '@confect/server';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import databaseSchema from '../_generated/schema';
import { MutationCtx } from '../_generated/services';
import owners from './owners.spec';
import { ownerRow } from './owners';

export default GroupImpl.make(databaseSchema, owners).pipe(
	Layer.provide([
		FunctionImpl.make(databaseSchema, owners, 'grantFileOwner', ({ fileId, ownerId }) =>
			Effect.gen(function* () {
				const ctx = yield* MutationCtx;
				yield* Effect.promise(async () => {
					if ((await ownerRow(ctx, fileId, ownerId)) === null) {
						await ctx.db.insert('fileOwners', { fileId, ownerId });
					}
				});
				return null;
			})
		)
	]),
	GroupImpl.finalize
);
