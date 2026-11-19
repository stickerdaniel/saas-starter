/** T0 spike: `aiChat/activityMigration.start` on Confect; schedules the plain `runPage`. */
import { FunctionSpec, GroupSpec, Ref } from '@confect/core';
import {
	ConvexFunctionDefinitions,
	FunctionImpl,
	GroupImpl,
	RegisteredConvexFunction,
	Scheduler,
	type RegisteredFunctions
} from '@confect/server';
import * as Clock from 'effect/Clock';
import * as DateTime from 'effect/DateTime';
import * as Duration from 'effect/Duration';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import * as Option from 'effect/Option';
import * as Schema from 'effect/Schema';
import type { runPage } from '../aiChat/activityMigration';
import databaseSchema from '../../confect/schema';
import { DatabaseReader, DatabaseWriter } from '../../confect/services';

const PAGE_DELAY_MS = 250;

/** A Confect ref to the plain Convex `runPage`. */
const runPageRef = Ref.make(
	'aiChat/activityMigration',
	FunctionSpec.convexInternalMutation<typeof runPage>()('runPage')
);

const Progress = Schema.Struct({
	version: Schema.Literal(1),
	status: Schema.Literals(['running', 'complete']),
	processed: Schema.Finite
});

const spec = GroupSpec.make().addFunction(
	FunctionSpec.internalMutation({
		name: 'startActivityMigration',
		args: () => ({ restart: Schema.optional(Schema.Boolean) }),
		returns: () => Progress
	})
);

const startImpl = FunctionImpl.make(databaseSchema, spec, 'startActivityMigration', (args) =>
	Effect.gen(function* () {
		const reader = yield* DatabaseReader;
		const writer = yield* DatabaseWriter;
		const scheduler = yield* Scheduler.Scheduler;
		const existing = Option.getOrNull(
			yield* reader.table('aiChatHistoryMigration').index('by_creation_time').first()
		);
		if (existing && (existing.status === 'running' || !args.restart)) {
			if (existing.status === 'running') {
				const job = existing.scheduledFnId
					? Option.getOrNull(
							yield* reader
								.table('_scheduled_functions')
								.get(existing.scheduledFnId)
								.pipe(Effect.option)
						)
					: null;
				if (!job || (job.state.kind !== 'pending' && job.state.kind !== 'inProgress')) {
					const now = yield* Clock.currentTimeMillis;
					const scheduledFnId = yield* scheduler.runAt(
						DateTime.makeUnsafe(now + PAGE_DELAY_MS),
						runPageRef,
						{ id: existing._id, cursor: existing.cursor }
					);
					yield* writer.table('aiChatHistoryMigration').patch(existing._id, { scheduledFnId });
				}
			}
			return { version: existing.version, status: existing.status, processed: existing.processed };
		}
		if (existing) yield* writer.table('aiChatHistoryMigration').delete(existing._id);
		const hasRows = Option.isSome(
			yield* reader.table('aiChatThreads').index('by_creation_time').first()
		);
		const status = hasRows ? ('running' as const) : ('complete' as const);
		const id = yield* writer
			.table('aiChatHistoryMigration')
			.insert({ version: 1, status, cursor: null, processed: 0 });
		if (hasRows) {
			const scheduledFnId = yield* scheduler.runAfter(Duration.millis(PAGE_DELAY_MS), runPageRef, {
				id,
				cursor: null
			});
			yield* writer.table('aiChatHistoryMigration').patch(id, { scheduledFnId });
		}
		return { version: 1 as const, status, processed: 0 };
	}).pipe(Effect.orDie)
);

const definitions = ConvexFunctionDefinitions.buildForGroup<typeof spec>(
	databaseSchema,
	GroupImpl.make(databaseSchema, spec).pipe(Layer.provide(startImpl), GroupImpl.finalize)
);
type Registered = RegisteredFunctions.RegisteredFunctionsForGroupSpec<typeof spec>;

export const startActivityMigration = RegisteredConvexFunction.register(
	definitions.startActivityMigration
) as Registered['startActivityMigration'];
