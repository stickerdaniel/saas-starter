import { FunctionImpl, GroupImpl } from '@confect/server';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import { components } from '../../convex/_generated/api';
import type {
	MutationCtx as ConvexMutationCtx,
	QueryCtx as ConvexQueryCtx
} from '../../convex/_generated/server';
import databaseSchema from '../_generated/schema';
import { MutationCtx, QueryCtx } from '../_generated/services';
import { RateLimited } from '../../effect/errors';
import RequireUserImpl from '../middleware/RequireUser.impl';
import { CurrentUser } from '../middleware/RequireUser.spec';
import { aiChatAgent } from './agent';
import { ownedAiChatThread } from './ownership';
import { aiChatRateLimiter } from './rateLimit';
import type { ThreadMetadataArgsSchema } from './schemas';
import threads from './threads.spec';
import { getAiChatSidebarActivityAt } from './visibility';

const THREAD_PREVIEW_LENGTH = 100;
const DEFAULT_LIST_LIMIT = 20;
const STALE_WARM_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const STALE_WARM_BATCH = 100;

const withMutation = <A>(run: (ctx: ConvexMutationCtx) => Promise<A>) =>
	MutationCtx.use((ctx) => Effect.promise(() => run(ctx)));

const withQuery = <A>(run: (ctx: ConvexQueryCtx) => Promise<A>) =>
	QueryCtx.use((ctx) => Effect.promise(() => run(ctx)));

const limitThreadCreate = (userId: string) =>
	Effect.gen(function* () {
		const status = yield* withMutation((ctx) =>
			aiChatRateLimiter.limit(ctx, 'aiChatThreadCreate', { key: userId })
		);
		if (!status.ok) return yield* Effect.fail(new RateLimited({ retryAfter: status.retryAfter }));
	});

const warmRecord = (ctx: ConvexQueryCtx, userId: string) =>
	ctx.db
		.query('aiChatThreads')
		.withIndex('by_user_warm', (q) => q.eq('userId', userId).eq('isWarm', true))
		.first();

const threadRecord = (ctx: ConvexQueryCtx, threadId: string) =>
	ctx.db
		.query('aiChatThreads')
		.withIndex('by_thread', (q) => q.eq('threadId', threadId))
		.first();

async function openThread(ctx: ConvexMutationCtx, userId: string, isWarm: boolean) {
	const { threadId } = await aiChatAgent.createThread(ctx, { userId, title: 'New chat' });
	await ctx.db.insert('aiChatThreads', {
		threadId,
		userId,
		createdAt: Date.now(),
		...(isWarm ? { isWarm: true } : {})
	});
	return { threadId };
}

async function listOwnThreads(ctx: ConvexQueryCtx, userId: string, limit: number) {
	const records = await ctx.db
		.query('aiChatThreads')
		.withIndex('by_userId_and_sidebarActivityAt', (q) =>
			q.eq('userId', userId).gt('sidebarActivityAt', undefined)
		)
		.order('desc')
		.take(limit + 1);
	return {
		threads: records.slice(0, limit).map((record) => ({
			_id: record.threadId,
			title: record.title,
			lastMessage: record.lastMessage ?? undefined,
			lastMessageAt: record.lastMessageAt ?? record.createdAt
		})),
		hasMore: records.length > limit
	};
}

async function deleteStaleWarm(ctx: ConvexMutationCtx) {
	const cutoffTime = Date.now() - STALE_WARM_AGE_MS;
	const staleRecords = await ctx.db
		.query('aiChatThreads')
		// eslint-disable-next-line @convex-dev/no-filter-in-query -- bounded by take(100); a compound index is not worth it for a once-per-cron sweep
		.filter((q) => q.and(q.eq(q.field('isWarm'), true), q.lt(q.field('_creationTime'), cutoffTime)))
		.take(STALE_WARM_BATCH);
	for (const record of staleRecords) await ctx.db.delete('aiChatThreads', record._id);
	return { deleted: staleRecords.length };
}

async function patchMetadata(ctx: ConvexMutationCtx, args: typeof ThreadMetadataArgsSchema.Type) {
	const record = await threadRecord(ctx, args.threadId);
	if (!record) return;
	const patch: { lastMessage?: string; lastMessageAt?: number; sidebarActivityAt?: number } = {};
	if (args.lastMessage !== undefined) patch.lastMessage = args.lastMessage;
	if (args.lastMessageAt !== undefined) patch.lastMessageAt = args.lastMessageAt;
	if (Object.keys(patch).length === 0) return;
	patch.sidebarActivityAt = getAiChatSidebarActivityAt({ ...record, ...patch });
	await ctx.db.patch('aiChatThreads', record._id, patch);
}

async function backfillMetadata(ctx: ConvexMutationCtx) {
	// eslint-disable-next-line @convex-dev/no-collect-in-query -- Manual one-time backfill for pre-release data; the table grows per user, so past the read limit this mutation fails whole instead of skipping rows
	const records = await ctx.db.query('aiChatThreads').collect();
	let updated = 0;
	for (const record of records) {
		if (record.lastMessage) continue;
		const agentThread = await ctx.runQuery(components.agent.threads.getThread, {
			threadId: record.threadId
		});
		const messages = await ctx.runQuery(components.agent.messages.listMessagesByThreadId, {
			threadId: record.threadId,
			order: 'desc',
			statuses: ['success'],
			excludeToolMessages: true,
			paginationOpts: { numItems: 1, cursor: null }
		});
		const lastMsg = messages.page[0];
		if (!lastMsg?.text) continue;
		await ctx.db.patch('aiChatThreads', record._id, {
			title: agentThread?.title,
			lastMessage: lastMsg.text.slice(0, THREAD_PREVIEW_LENGTH),
			lastMessageAt: lastMsg._creationTime,
			sidebarActivityAt: getAiChatSidebarActivityAt({
				...record,
				lastMessageAt: lastMsg._creationTime
			})
		});
		updated++;
	}
	return { updated, total: records.length };
}

export default GroupImpl.make(databaseSchema, threads).pipe(
	Layer.provide([
		FunctionImpl.make(databaseSchema, threads, 'backfillThreadMetadata', () =>
			Effect.gen(function* () {
				return yield* withMutation(backfillMetadata);
			})
		),
		FunctionImpl.make(databaseSchema, threads, 'createThread', () =>
			Effect.gen(function* () {
				const { _id: userId } = yield* CurrentUser;
				yield* limitThreadCreate(userId);
				return yield* withMutation((ctx) => openThread(ctx, userId, false));
			})
		),
		FunctionImpl.make(databaseSchema, threads, 'deleteStaleWarmThreads', () =>
			Effect.gen(function* () {
				return yield* withMutation(deleteStaleWarm);
			})
		),
		FunctionImpl.make(databaseSchema, threads, 'deleteThread', ({ threadId }) =>
			Effect.gen(function* () {
				const { _id: userId } = yield* CurrentUser;
				const ctx = yield* MutationCtx;
				const record = yield* ownedAiChatThread(ctx, { threadId, userId });
				yield* Effect.promise(() => ctx.db.delete('aiChatThreads', record._id));
				return null;
			})
		),
		FunctionImpl.make(databaseSchema, threads, 'getOrCreateWarmThread', () =>
			Effect.gen(function* () {
				const { _id: userId } = yield* CurrentUser;
				const existing = yield* withMutation((ctx) => warmRecord(ctx, userId));
				if (existing) return { threadId: existing.threadId };
				yield* limitThreadCreate(userId);
				return yield* withMutation((ctx) => openThread(ctx, userId, true));
			})
		),
		FunctionImpl.make(databaseSchema, threads, 'getWarmThread', () =>
			Effect.gen(function* () {
				const { _id: userId } = yield* CurrentUser;
				const record = yield* withQuery((ctx) => warmRecord(ctx, userId));
				return record ? { threadId: record.threadId } : null;
			})
		),
		FunctionImpl.make(databaseSchema, threads, 'listThreads', ({ limit }) =>
			Effect.gen(function* () {
				const { _id: userId } = yield* CurrentUser;
				return yield* withQuery((ctx) => listOwnThreads(ctx, userId, limit ?? DEFAULT_LIST_LIMIT));
			})
		),
		FunctionImpl.make(databaseSchema, threads, 'setThreadTitleIfEmpty', ({ threadId, title }) =>
			Effect.gen(function* () {
				const ctx = yield* MutationCtx;
				const record = yield* Effect.promise(() => threadRecord(ctx, threadId));
				if (!record || record.title) return null;
				yield* Effect.promise(() => ctx.db.patch('aiChatThreads', record._id, { title }));
				return null;
			})
		),
		FunctionImpl.make(databaseSchema, threads, 'updateThreadMetadata', (args) =>
			Effect.gen(function* () {
				yield* withMutation((ctx) => patchMetadata(ctx, args));
				return null;
			})
		)
	]),
	Layer.provide(RequireUserImpl),
	GroupImpl.finalize
);
