import { FunctionImpl, GroupImpl } from '@confect/server';
import * as Duration from 'effect/Duration';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import { components } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import type { MutationCtx as ConvexMutationCtx } from '../../convex/_generated/server';
import refs from '../_generated/refs';
import databaseSchema from '../_generated/schema';
import { MutationCtx, Scheduler } from '../_generated/services';
import vacuum from './vacuum.spec';

const UNTOUCHED_FOR = Duration.hours(24);

const metadataRowsOf = (ctx: ConvexMutationCtx, storageId: string) =>
	// eslint-disable-next-line @convex-dev/no-collect-in-query -- Bounded: <=100 files per batch, fileMetadata is deduped by URL (~1 row per file)
	ctx.db
		.query('fileMetadata')
		.withIndex('by_storageId', (q) => q.eq('storageId', storageId))
		.collect();

export default GroupImpl.make(databaseSchema, vacuum).pipe(
	Layer.provide([
		FunctionImpl.make(databaseSchema, vacuum, 'deleteUnusedFiles', ({ cursor }) =>
			Effect.gen(function* () {
				const ctx = yield* MutationCtx;
				const files = yield* Effect.promise(() =>
					ctx.runQuery(components.agent.files.getFilesToDelete, {
						paginationOpts: { cursor: cursor ?? null, numItems: 100 }
					})
				);
				const touchedBefore = Date.now() - Duration.toMillis(UNTOUCHED_FOR);
				const toDelete = files.page.filter((file) => file.lastTouchedAt < touchedBefore);
				if (toDelete.length > 0) {
					yield* Effect.logDebug(`Deleting ${toDelete.length} files...`);
				}
				const deletedIds = new Set(
					yield* Effect.promise(() =>
						ctx.runMutation(components.agent.files.deleteFiles, {
							fileIds: toDelete.map((file) => file._id)
						})
					)
				);
				const deleted = toDelete.filter((file) => deletedIds.has(file._id));
				yield* Effect.promise(() =>
					Promise.all(deleted.map((file) => ctx.storage.delete(file.storageId as Id<'_storage'>)))
				);
				for (const file of deleted) {
					const rows = yield* Effect.promise(() => metadataRowsOf(ctx, file.storageId));
					yield* Effect.promise(() =>
						Promise.all(rows.map((row) => ctx.db.delete('fileMetadata', row._id)))
					);
				}
				if (deleted.length > 0) {
					yield* (yield* Scheduler).runAfter(Duration.zero, refs.internal.files.owners.purge, {
						fileIds: deleted.map((file) => file._id)
					});
				}
				if (!files.isDone) {
					yield* Effect.logDebug(
						`Deleted ${toDelete.length} files but not done yet, continuing...`
					);
					yield* (yield* Scheduler).runAfter(
						Duration.zero,
						refs.internal.files.vacuum.deleteUnusedFiles,
						{ cursor: files.continueCursor }
					);
				}
				return null;
			})
		)
	]),
	GroupImpl.finalize
);
