import { FunctionImpl, GroupImpl } from '@confect/server';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import databaseSchema from '../_generated/schema';
import { MutationCtx } from '../_generated/services';
import metadata from './metadata.spec';

export default GroupImpl.make(databaseSchema, metadata).pipe(
	Layer.provide([
		FunctionImpl.make(
			databaseSchema,
			metadata,
			'storeFileMetadata',
			({ fileId, storageId, url, width, height }) =>
				Effect.gen(function* () {
					const ctx = yield* MutationCtx;
					const existing = yield* Effect.promise(() =>
						ctx.db
							.query('fileMetadata')
							.withIndex('by_url', (q) => q.eq('url', url))
							.first()
					);
					if (existing) {
						yield* Effect.promise(() =>
							ctx.db.patch('fileMetadata', existing._id, { width, height })
						);
						return existing._id;
					}
					return yield* Effect.promise(() =>
						ctx.db.insert('fileMetadata', {
							fileId,
							storageId,
							url,
							width,
							height,
							createdAt: Date.now()
						})
					);
				})
		)
	]),
	GroupImpl.finalize
);
