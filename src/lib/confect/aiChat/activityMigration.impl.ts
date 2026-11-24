import { FunctionImpl, GroupImpl } from '@confect/server';
import * as DateTime from 'effect/DateTime';
import * as Duration from 'effect/Duration';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import type { Doc } from '../../convex/_generated/dataModel';
import type {
	MutationCtx as ConvexMutationCtx,
	QueryCtx as ConvexQueryCtx
} from '../../convex/_generated/server';
import refs from '../_generated/refs';
import databaseSchema from '../_generated/schema';
import { MutationCtx, QueryCtx, Scheduler } from '../_generated/services';
import activityMigration from './activityMigration.spec';
import { getAiChatSidebarActivityAt } from './visibility';

const PAGE_DELAY = Duration.millis(250);

type Migration = Doc<'aiChatHistoryMigration'>;

const withMutation = <A>(run: (ctx: ConvexMutationCtx) => Promise<A>) =>
	MutationCtx.use((ctx) => Effect.promise(() => run(ctx)));

const progress = (state: Pick<Migration, 'version' | 'status' | 'processed'>) => ({
	version: state.version,
	status: state.status,
	processed: state.processed
});

async function readMigration(ctx: ConvexQueryCtx) {
	return await ctx.db.query('aiChatHistoryMigration').unique();
}

async function hasLiveJob(ctx: ConvexMutationCtx, state: Migration) {
	const job = state.scheduledFnId ? await ctx.db.system.get(state.scheduledFnId) : null;
	return job !== null && (job.state.kind === 'pending' || job.state.kind === 'inProgress');
}

async function openRun(ctx: ConvexMutationCtx, existing: Migration | null) {
	if (existing) await ctx.db.delete('aiChatHistoryMigration', existing._id);
	const hasRows = (await ctx.db.query('aiChatThreads').first()) !== null;
	const status = hasRows ? ('running' as const) : ('complete' as const);
	const id = await ctx.db.insert('aiChatHistoryMigration', {
		version: 1,
		status,
		cursor: null,
		processed: 0
	});
	return { id, status };
}

async function migratePage(ctx: ConvexMutationCtx, state: Migration, cursor: string | null) {
	const result = await ctx.db.query('aiChatThreads').paginate({
		cursor,
		numItems: 100,
		maximumBytesRead: 512 * 1024
	});
	for (const row of result.page) {
		const sidebarActivityAt = getAiChatSidebarActivityAt(row);
		if (row.sidebarActivityAt !== sidebarActivityAt) {
			await ctx.db.patch('aiChatThreads', row._id, { sidebarActivityAt });
		}
	}
	return {
		cursor: result.continueCursor,
		isDone: result.isDone,
		processed: state.processed + result.page.length
	};
}

export default GroupImpl.make(databaseSchema, activityMigration).pipe(
	Layer.provide([
		FunctionImpl.make(databaseSchema, activityMigration, 'start', (args) =>
			Effect.gen(function* () {
				const existing = yield* withMutation(readMigration);
				const scheduler = yield* Scheduler;
				if (existing && (existing.status === 'running' || !args.restart)) {
					if (
						existing.status === 'running' &&
						!(yield* withMutation((ctx) => hasLiveJob(ctx, existing)))
					) {
						const scheduledFnId = yield* scheduler.runAt(
							DateTime.makeUnsafe(Date.now() + Duration.toMillis(PAGE_DELAY)),
							refs.internal.aiChat.activityMigration.runPage,
							{ id: existing._id, cursor: existing.cursor }
						);
						yield* withMutation((ctx) =>
							ctx.db.patch('aiChatHistoryMigration', existing._id, { scheduledFnId })
						);
					}
					return progress(existing);
				}
				const { id, status } = yield* withMutation((ctx) => openRun(ctx, existing));
				if (status === 'running') {
					const scheduledFnId = yield* scheduler.runAfter(
						PAGE_DELAY,
						refs.internal.aiChat.activityMigration.runPage,
						{ id, cursor: null }
					);
					yield* withMutation((ctx) =>
						ctx.db.patch('aiChatHistoryMigration', id, { scheduledFnId })
					);
				}
				return progress({ version: 1, status, processed: 0 });
			})
		),
		FunctionImpl.make(databaseSchema, activityMigration, 'status', () =>
			Effect.gen(function* () {
				const state = yield* QueryCtx.use((ctx) => Effect.promise(() => readMigration(ctx)));
				return state ? progress(state) : null;
			})
		),
		FunctionImpl.make(databaseSchema, activityMigration, 'runPage', (args) =>
			Effect.gen(function* () {
				const state = yield* withMutation((ctx) => ctx.db.get('aiChatHistoryMigration', args.id));
				if (!state || state.status !== 'running' || state.cursor !== args.cursor) return null;
				const page = yield* withMutation((ctx) => migratePage(ctx, state, args.cursor));
				const scheduledFnId = page.isDone
					? undefined
					: yield* (yield* Scheduler).runAfter(
							PAGE_DELAY,
							refs.internal.aiChat.activityMigration.runPage,
							{ id: args.id, cursor: page.cursor }
						);
				yield* withMutation((ctx) =>
					ctx.db.patch('aiChatHistoryMigration', args.id, {
						cursor: page.cursor,
						processed: page.processed,
						status: page.isDone ? 'complete' : 'running',
						scheduledFnId
					})
				);
				return null;
			})
		)
	]),
	GroupImpl.finalize
);
