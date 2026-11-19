/** T0 spike: `aiChat/activityMigration.start` on the Effect adapter. */
import * as Clock from 'effect/Clock';
import * as Effect from 'effect/Effect';
import { v, type Infer } from 'convex/values';
import { internal } from '../_generated/api';
import {
	ConvexScheduler,
	DatabaseWriter,
	effectInternalMutation,
	type MutationServices
} from '../effect';

const PAGE_DELAY_MS = 250;
const progressValidator = v.object({
	version: v.literal(1),
	status: v.union(v.literal('running'), v.literal('complete')),
	processed: v.number()
});

/** Port of `aiChat/activityMigration.start`; schedules the plain `runPage`. */
export const startActivityMigration = effectInternalMutation({
	args: { restart: v.optional(v.boolean()) },
	returns: progressValidator,
	// Annotated: the scheduled reference reads `internal`, whose type includes this module.
	handler: (args): Effect.Effect<Infer<typeof progressValidator>, never, MutationServices> =>
		Effect.gen(function* () {
			const db = yield* DatabaseWriter;
			const scheduler = yield* ConvexScheduler;
			const existing = yield* Effect.promise(() => db.query('aiChatHistoryMigration').unique());
			if (existing && (existing.status === 'running' || !args.restart)) {
				if (existing.status === 'running') {
					const job = existing.scheduledFnId
						? yield* Effect.promise(() => db.system.get(existing.scheduledFnId!))
						: null;
					if (!job || (job.state.kind !== 'pending' && job.state.kind !== 'inProgress')) {
						const now = yield* Clock.currentTimeMillis;
						const scheduledFnId = yield* Effect.promise(() =>
							scheduler.runAt(now + PAGE_DELAY_MS, internal.aiChat.activityMigration.runPage, {
								id: existing._id,
								cursor: existing.cursor
							})
						);
						yield* Effect.promise(() =>
							db.patch('aiChatHistoryMigration', existing._id, { scheduledFnId })
						);
					}
				}
				return {
					version: existing.version,
					status: existing.status,
					processed: existing.processed
				};
			}
			if (existing) yield* Effect.promise(() => db.delete('aiChatHistoryMigration', existing._id));
			const hasRows = (yield* Effect.promise(() => db.query('aiChatThreads').first())) !== null;
			const status = hasRows ? ('running' as const) : ('complete' as const);
			const id = yield* Effect.promise(() =>
				db.insert('aiChatHistoryMigration', { version: 1, status, cursor: null, processed: 0 })
			);
			if (hasRows) {
				const scheduledFnId = yield* Effect.promise(() =>
					scheduler.runAfter(PAGE_DELAY_MS, internal.aiChat.activityMigration.runPage, {
						id,
						cursor: null
					})
				);
				yield* Effect.promise(() => db.patch('aiChatHistoryMigration', id, { scheduledFnId }));
			}
			return { version: 1 as const, status, processed: 0 };
		})
});
