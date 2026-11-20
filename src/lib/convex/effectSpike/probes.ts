/**
 * T0 spike probes on Confect: yield stress with its default-scheduler control,
 * error identity, the query clock, and an Effect program inside a native
 * httpAction.
 */
import { FunctionSpec, GroupSpec } from '@confect/core';
import {
	ConvexFunctionDefinitions,
	FunctionImpl,
	GroupImpl,
	RegisteredConvexFunction,
	type RegisteredFunctions
} from '@confect/server';
import * as Cause from 'effect/Cause';
import * as Clock from 'effect/Clock';
import * as Data from 'effect/Data';
import * as Effect from 'effect/Effect';
import * as Exit from 'effect/Exit';
import * as Layer from 'effect/Layer';
import * as Schema from 'effect/Schema';
import { v } from 'convex/values';
import { httpAction, internalMutation, internalQuery } from '../_generated/server';
import { ADMIN_ERROR_CODES, createAdminError } from '../admin/errors';
import databaseSchema from '../../confect/schema';
import { DatabaseReader } from '../../confect/services';

/* Yield stress. `autoYielded` is true when a microtask queued before the loop
 * ran before the loop finished: without a yield the loop is one synchronous
 * run and the microtask runs after it. */

const STRESS_ITEMS = 3_000;
const yieldObserver = () => {
	let ran = false;
	void Promise.resolve().then(() => {
		ran = true;
	});
	return () => ran;
};

const forEachStress = Effect.gen(function* () {
	const ran = yield* Effect.sync(yieldObserver);
	const items = yield* Effect.forEach(
		Array.from({ length: STRESS_ITEMS }, (_, i) => i),
		(i) => Effect.succeed(i)
	);
	return { items: items.length, autoYielded: ran() };
});

/** A traced per-document step, the form `Effect.fn` gives an operation. */
const messageLength = Effect.fn('effectSpike.messageLength')(function* (body: string) {
	const trimmed = yield* Effect.sync(() => body.trim());
	return trimmed.length;
});

/** The observer starts after the read, so the read's own await is not counted as a yield. */
const readStress = <E, R>(
	read: Effect.Effect<ReadonlyArray<{ readonly body: string }>, E, R>,
	perDoc: 'succeed' | 'traced'
) =>
	Effect.gen(function* () {
		const docs = yield* read;
		const ran = yield* Effect.sync(yieldObserver);
		const lengths = yield* Effect.forEach(docs, (doc) =>
			perDoc === 'succeed' ? Effect.succeed(doc.body.length) : messageLength(doc.body)
		);
		return { items: lengths.length, autoYielded: ran() };
	});

const confectMessages = (limit: number) =>
	DatabaseReader.use((reader) =>
		reader.table('messages').index('by_creation_time').take(limit).pipe(Effect.orDie)
	);

/* Query clock. The probe counts every `Date.now()` call made while its body
 * runs (logs, spans, and an optional explicit read) and records what the
 * clock's ambient accessors returned. */

function spyClock(clock: Clock.Clock) {
	const counts = { ambientCalls: 0, ambientNonZero: 0 };
	const record = <T extends number | bigint>(value: T): T => {
		counts.ambientCalls++;
		if (value !== 0 && value !== 0n) counts.ambientNonZero++;
		return value;
	};
	const spied: Clock.Clock = {
		currentTimeMillisUnsafe: () => record(clock.currentTimeMillisUnsafe()),
		currentTimeNanosUnsafe: () => record(clock.currentTimeNanosUnsafe()),
		monotonicTimeNanosUnsafe: () => record(clock.monotonicTimeNanosUnsafe()),
		currentTimeMillis: clock.currentTimeMillis,
		currentTimeNanos: clock.currentTimeNanos,
		monotonicTimeNanos: clock.monotonicTimeNanos,
		sleep: (duration) => clock.sleep(duration)
	};
	return { spied, counts };
}

const dateNowSpy = Effect.acquireRelease(
	Effect.sync(() => {
		const RealDate = globalThis.Date;
		const counter = { calls: 0 };
		globalThis.Date = new Proxy(RealDate, {
			get(target, property, receiver) {
				if (property !== 'now') return Reflect.get(target, property, receiver);
				return () => {
					counter.calls++;
					return target.now();
				};
			}
		});
		return { counter, RealDate };
	}),
	({ RealDate }) =>
		Effect.sync(() => {
			globalThis.Date = RealDate;
		})
);

const probeBody = (explicit: boolean) =>
	Effect.gen(function* () {
		const reader = yield* DatabaseReader;
		yield* reader.table('passkeyNudgeDismissals').index('by_creation_time').first();
		yield* Effect.log('probe read done');
		yield* Effect.logDebug('probe debug line');
		yield* Effect.annotateCurrentSpan('probe', true);
		return explicit ? yield* Clock.currentTimeMillis : null;
	}).pipe(Effect.withSpan('effectSpike.clockProbe'), Effect.orDie);

const clockProbe = (explicit: boolean, live: boolean) =>
	Effect.scoped(
		Effect.gen(function* () {
			const current = live ? Clock.Clock.defaultValue() : yield* Clock.Clock;
			const { spied, counts } = spyClock(current);
			const { counter } = yield* dateNowSpy;
			const explicitTime = yield* probeBody(explicit).pipe(
				Effect.provideService(Clock.Clock, spied)
			);
			return { dateNowCalls: counter.calls, ...counts, explicitTime };
		})
	);

/* Error identity. */

/** A `ConvexError` thrown by plain called code. */
async function plainLookup(userId: string): Promise<never> {
	throw createAdminError(ADMIN_ERROR_CODES.userNotFound, { userId });
}

export class SpikeDefect extends Error {
	override readonly name = 'SpikeDefect';
}

const StressResult = Schema.Struct({ items: Schema.Finite, autoYielded: Schema.Boolean });
const PerDoc = Schema.Literals(['succeed', 'traced']);

const probesSpec = GroupSpec.make()
	.addFunction(FunctionSpec.internalQuery({ name: 'stressQuery', returns: () => StressResult }))
	.addFunction(
		FunctionSpec.internalMutation({ name: 'stressMutation', returns: () => StressResult })
	)
	.addFunction(
		FunctionSpec.internalQuery({
			name: 'readStressQuery',
			args: () => ({ limit: Schema.Finite, perDoc: PerDoc }),
			returns: () => StressResult
		})
	)
	.addFunction(
		FunctionSpec.internalQuery({
			name: 'passthroughQuery',
			args: () => ({ userId: Schema.String }),
			returns: () => Schema.Null
		})
	)
	.addFunction(FunctionSpec.internalQuery({ name: 'defectQuery', returns: () => Schema.Null }))
	.addFunction(
		FunctionSpec.internalQuery({
			name: 'clockProbeQuery',
			args: () => ({ explicit: Schema.Boolean, live: Schema.Boolean }),
			returns: () =>
				Schema.Struct({
					dateNowCalls: Schema.Finite,
					ambientCalls: Schema.Finite,
					ambientNonZero: Schema.Finite,
					explicitTime: Schema.NullOr(Schema.Finite)
				})
		})
	);

const definitions = ConvexFunctionDefinitions.buildForGroup<typeof probesSpec>(
	databaseSchema,
	GroupImpl.make(databaseSchema, probesSpec).pipe(
		Layer.provide(
			FunctionImpl.make(databaseSchema, probesSpec, 'stressQuery', () => forEachStress)
		),
		Layer.provide(
			FunctionImpl.make(databaseSchema, probesSpec, 'stressMutation', () => forEachStress)
		),
		Layer.provide(
			FunctionImpl.make(databaseSchema, probesSpec, 'readStressQuery', ({ limit, perDoc }) =>
				readStress(confectMessages(limit), perDoc)
			)
		),
		Layer.provide(
			FunctionImpl.make(databaseSchema, probesSpec, 'passthroughQuery', ({ userId }) =>
				Effect.promise(() => plainLookup(userId))
			)
		),
		Layer.provide(
			FunctionImpl.make(databaseSchema, probesSpec, 'defectQuery', () =>
				Effect.die(new SpikeDefect('spike defect'))
			)
		),
		Layer.provide(
			FunctionImpl.make(databaseSchema, probesSpec, 'clockProbeQuery', ({ explicit, live }) =>
				clockProbe(explicit, live)
			)
		),
		GroupImpl.finalize
	)
);
type Registered = RegisteredFunctions.RegisteredFunctionsForGroupSpec<typeof probesSpec>;

export const stressQuery = RegisteredConvexFunction.register(
	definitions.stressQuery
) as Registered['stressQuery'];
export const stressMutation = RegisteredConvexFunction.register(
	definitions.stressMutation
) as Registered['stressMutation'];
export const readStressQuery = RegisteredConvexFunction.register(
	definitions.readStressQuery
) as Registered['readStressQuery'];
export const passthroughQuery = RegisteredConvexFunction.register(
	definitions.passthroughQuery
) as Registered['passthroughQuery'];
export const defectQuery = RegisteredConvexFunction.register(
	definitions.defectQuery
) as Registered['defectQuery'];
export const clockProbeQuery = RegisteredConvexFunction.register(
	definitions.clockProbeQuery
) as Registered['clockProbeQuery'];

/* Control: the same programs on Effect's default scheduler, as plain functions. */

const stressResult = v.object({ items: v.number(), autoYielded: v.boolean() });
const perDocValidator = v.union(v.literal('succeed'), v.literal('traced'));

export const stressQueryDefaultScheduler = internalQuery({
	args: {},
	returns: stressResult,
	handler: () => Effect.runPromise(forEachStress)
});
export const stressMutationDefaultScheduler = internalMutation({
	args: {},
	returns: stressResult,
	handler: () => Effect.runPromise(forEachStress)
});
export const readStressQueryDefaultScheduler = internalQuery({
	args: { limit: v.number(), perDoc: perDocValidator },
	returns: stressResult,
	handler: (ctx, { limit, perDoc }) =>
		Effect.runPromise(
			readStress(
				Effect.promise(() => ctx.db.query('messages').take(limit)),
				perDoc
			)
		)
});

/* HTTP: Confect has no boundary for a native httpAction, so this runs the
 * program the same way the adapter's `runHttpAction` does. */

class EchoRefused extends Data.TaggedError('EchoRefused')<{ readonly reason: string }> {}

export const echoHttp = httpAction((_ctx, request) => {
	const mode = new URL(request.url).searchParams.get('mode');
	const program = Effect.gen(function* () {
		if (mode === 'refuse') return yield* new EchoRefused({ reason: 'mode=refuse' });
		if (mode === 'defect') return yield* Effect.die(new SpikeDefect('http defect'));
		return Response.json({ ok: true, mode });
	}).pipe(
		Effect.catchTag('EchoRefused', (error) =>
			Effect.succeed(Response.json({ ok: false, reason: error.reason }, { status: 409 }))
		)
	);
	return Effect.runPromiseExit(program).then((exit) => {
		if (Exit.isSuccess(exit)) return exit.value;
		throw Cause.squash(exit.cause);
	});
});
