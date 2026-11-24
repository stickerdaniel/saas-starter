import { FunctionImpl, GroupImpl } from '@confect/server';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import * as Option from 'effect/Option';
import type { QueryCtx as ConvexQueryCtx } from '../../convex/_generated/server';
import databaseSchema from '../_generated/schema';
import { MutationCtx, QueryCtx } from '../_generated/services';
import VisitorAccessImpl, { requireOwnedSupportThread } from '../middleware/VisitorAccess.impl';
import { SupportOwner } from '../middleware/VisitorAccess.spec';
import readState from './readState.spec';

const UNREAD_COUNT_CAP = 10;

const unreadThreadsOf = (ctx: ConvexQueryCtx, ownerId: string) =>
	ctx.db
		.query('supportThreads')
		.withIndex('by_user_and_unread_admin_reply', (q) =>
			q.eq('userId', ownerId).eq('hasUnreadAdminReply', true)
		);

const readUnreadThreads = <A>(
	read: (threads: ReturnType<typeof unreadThreadsOf>) => Promise<A>,
	empty: A
) =>
	Effect.gen(function* () {
		const owner = yield* SupportOwner;
		if (Option.isNone(owner)) return empty;
		return yield* QueryCtx.use((ctx) =>
			Effect.promise(() => read(unreadThreadsOf(ctx, owner.value.ownerId)))
		);
	});

export default GroupImpl.make(databaseSchema, readState).pipe(
	Layer.provide([
		FunctionImpl.make(databaseSchema, readState, 'hasUnreadAdminReply', () =>
			Effect.gen(function* () {
				const unreadThread = yield* readUnreadThreads((threads) => threads.first(), null);
				return unreadThread !== null;
			})
		),
		FunctionImpl.make(
			databaseSchema,
			readState,
			'markThreadRead',
			({ threadId, readThroughMessageId }) =>
				Effect.gen(function* () {
					const ctx = yield* MutationCtx;
					const { supportThread } = yield* requireOwnedSupportThread(ctx.db, threadId);
					if (
						supportThread.lastAdminReplyMessageId !== readThroughMessageId ||
						supportThread.hasUnreadAdminReply !== true
					) {
						return null;
					}
					yield* Effect.promise(() =>
						ctx.db.patch('supportThreads', supportThread._id, {
							userReadAt: Date.now(),
							hasUnreadAdminReply: false,
							unreadAdminReplyCount: 0
						})
					);
					return null;
				})
		),
		FunctionImpl.make(databaseSchema, readState, 'unreadAdminReplyCount', () =>
			Effect.gen(function* () {
				const threads = yield* readUnreadThreads((unread) => unread.take(UNREAD_COUNT_CAP), []);
				return threads.reduce(
					(total, thread) =>
						Math.min(UNREAD_COUNT_CAP, total + Math.max(1, thread.unreadAdminReplyCount ?? 1)),
					0
				);
			})
		)
	]),
	Layer.provide(VisitorAccessImpl),
	GroupImpl.finalize
);
