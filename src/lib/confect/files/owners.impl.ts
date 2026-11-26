import { FunctionImpl, GroupImpl } from '@confect/server';
import * as Duration from 'effect/Duration';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import type { MutationCtx as ConvexMutationCtx } from '../../convex/_generated/server';
import refs from '../_generated/refs';
import databaseSchema from '../_generated/schema';
import { MutationCtx, Scheduler } from '../_generated/services';
import { ownerRow } from './owners';
import owners from './owners.spec';

const PURGE_BUDGET = 2_000;

async function purgeWithin(ctx: ConvexMutationCtx, fileIds: readonly string[], budget: number) {
	const pending: string[] = [];
	let left = budget;
	for (const fileId of fileIds) {
		if (left === 0) {
			pending.push(fileId);
			continue;
		}
		const rows = await ctx.db
			.query('fileOwners')
			.withIndex('by_fileId_and_ownerId', (q) => q.eq('fileId', fileId))
			.take(left + 1);
		const purged = rows.slice(0, left);
		await Promise.all(purged.map((row) => ctx.db.delete('fileOwners', row._id)));
		left -= purged.length;
		if (rows.length > purged.length) pending.push(fileId);
	}
	return pending;
}

export default GroupImpl.make(databaseSchema, owners).pipe(
	Layer.provide([
		FunctionImpl.make(databaseSchema, owners, 'purge', ({ fileIds }) =>
			Effect.gen(function* () {
				const ctx = yield* MutationCtx;
				const pending = yield* Effect.promise(() => purgeWithin(ctx, fileIds, PURGE_BUDGET));
				if (pending.length > 0) {
					yield* (yield* Scheduler).runAfter(Duration.zero, refs.internal.files.owners.purge, {
						fileIds: pending
					});
				}
				return null;
			})
		),
		FunctionImpl.make(databaseSchema, owners, 'record', ({ fileId, ownerId }) =>
			Effect.gen(function* () {
				const ctx = yield* MutationCtx;
				const existing = yield* Effect.promise(() => ownerRow(ctx, fileId, ownerId));
				if (existing === null) {
					yield* Effect.promise(() => ctx.db.insert('fileOwners', { fileId, ownerId }));
				}
				return null;
			})
		)
	]),
	GroupImpl.finalize
);
