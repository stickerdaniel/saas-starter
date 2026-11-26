import { FunctionImpl, GroupImpl } from '@confect/server';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import type { Doc } from '../../convex/_generated/dataModel';
import type { MutationCtx as ConvexMutationCtx } from '../../convex/_generated/server';
import databaseSchema from '../_generated/schema';
import { MutationCtx } from '../_generated/services';
import { SupportRefusal } from '../errorCodecs';
import { ownerRow } from '../files/owners';
import RequireUserImpl from '../middleware/RequireUser.impl';
import { CurrentUser } from '../middleware/RequireUser.spec';
import { isAnonymousUser } from '../utils/anonymousUser';
import { supportAgent } from './agent';
import { buildSupportSearchText } from './denormalization';
import { SUPPORT_ERROR_CODES } from './errors';
import migration from './migration.spec';

type AccountProfile = { _id: string; name: string; email: string };

const MAX_MOVED_FILE_OWNERS = 1_000;

const anonymousFileOwners = (ctx: ConvexMutationCtx, anonymousUserId: string) =>
	ctx.db
		.query('fileOwners')
		.withIndex('by_ownerId', (q) => q.eq('ownerId', anonymousUserId))
		.take(MAX_MOVED_FILE_OWNERS + 1);

async function moveFileOwners(
	ctx: ConvexMutationCtx,
	rows: ReadonlyArray<Doc<'fileOwners'>>,
	accountId: string
) {
	for (const row of rows) {
		if (await ownerRow(ctx, row.fileId, accountId)) {
			await ctx.db.delete('fileOwners', row._id);
		} else {
			await ctx.db.patch('fileOwners', row._id, { ownerId: accountId });
		}
	}
}

async function moveTickets(
	ctx: ConvexMutationCtx,
	anonymousUserId: string,
	{ _id: authUserId, name: authUserName, email: authUserEmail }: AccountProfile
) {
	// eslint-disable-next-line @convex-dev/no-collect-in-query -- Not capped over time: one global bucket (100/hour for all visitors) only slows anonymous thread creation; kept atomic because splitting lets a second account claim part of a history (see #1029)
	const supportThreads = await ctx.db
		.query('supportThreads')
		.withIndex('by_user_warm', (q) => q.eq('userId', anonymousUserId))
		.collect();

	for (const supportThread of supportThreads) {
		if (supportThread.isWarm) {
			try {
				await supportAgent.deleteThreadAsync(ctx, { threadId: supportThread.threadId });
			} catch {
				console.log({ code: 'warm_thread_delete_failed', threadId: supportThread.threadId });
				continue;
			}
			await ctx.db.delete('supportThreads', supportThread._id);
			continue;
		}

		await supportAgent.updateThreadMetadata(ctx, {
			threadId: supportThread.threadId,
			patch: { userId: authUserId }
		});
		await ctx.db.patch('supportThreads', supportThread._id, {
			userId: authUserId,
			userName: authUserName,
			userEmail: authUserEmail,
			searchText: buildSupportSearchText({
				title: supportThread.title,
				summary: supportThread.summary,
				lastMessage: supportThread.lastMessage,
				userName: authUserName,
				userEmail: authUserEmail
			}),
			notificationEmail: supportThread.notificationEmail || authUserEmail,
			updatedAt: Date.now()
		});
	}

	return {
		migratedCount: supportThreads.filter((supportThread) => !supportThread.isWarm).length
	};
}

export default GroupImpl.make(databaseSchema, migration).pipe(
	Layer.provide(
		FunctionImpl.make(databaseSchema, migration, 'migrateAnonymousTickets', ({ anonymousUserId }) =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				if (!isAnonymousUser(anonymousUserId)) {
					return yield* Effect.fail(
						new SupportRefusal({ refusal: { code: SUPPORT_ERROR_CODES.anonymousUserInvalid } })
					);
				}
				const ctx = yield* MutationCtx;
				const fileOwners = yield* Effect.promise(() => anonymousFileOwners(ctx, anonymousUserId));
				if (fileOwners.length > MAX_MOVED_FILE_OWNERS) {
					return yield* Effect.fail(
						new SupportRefusal({ refusal: { code: SUPPORT_ERROR_CODES.migrationTooManyFiles } })
					);
				}
				yield* Effect.promise(() => moveFileOwners(ctx, fileOwners, user._id));
				return yield* Effect.promise(() => moveTickets(ctx, anonymousUserId, user));
			})
		)
	),
	Layer.provide(RequireUserImpl),
	GroupImpl.finalize
);
