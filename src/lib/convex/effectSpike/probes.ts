/**
 * T0 spike probes: yield stress with its default-scheduler control, error
 * identity, the query clock, and an Effect program inside a native httpAction.
 */
import * as Clock from 'effect/Clock';
import * as Data from 'effect/Data';
import * as Effect from 'effect/Effect';
import { v } from 'convex/values';
import { httpAction, internalMutation, internalQuery } from '../_generated/server';
import { ADMIN_ERROR_CODES, createAdminError } from '../admin/errors';
import {
	call,
	DatabaseReader,
	effectInternalMutation,
	effectInternalQuery,
	runHttpAction
} from '../effect';

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
const readStress = (limit: number, perDoc: 'succeed' | 'traced') =>
	Effect.gen(function* () {
		const docs = yield* call(DatabaseReader, (db) => db.query('messages').take(limit));
		const ran = yield* Effect.sync(yieldObserver);
		const lengths = yield* Effect.forEach(docs, (doc) =>
			perDoc === 'succeed' ? Effect.succeed(doc.body.length) : messageLength(doc.body)
		);
		return { items: lengths.length, autoYielded: ran() };
	});

const stressResult = v.object({ items: v.number(), autoYielded: v.boolean() });

export const stressQuery = effectInternalQuery({
	args: {},
	returns: stressResult,
	handler: () => forEachStress
});
export const stressMutation = effectInternalMutation({
	args: {},
	returns: stressResult,
	handler: () => forEachStress
});
const perDocValidator = v.union(v.literal('succeed'), v.literal('traced'));

export const readStressQuery = effectInternalQuery({
	args: { limit: v.number(), perDoc: perDocValidator },
	returns: stressResult,
	handler: ({ limit, perDoc }) => readStress(limit, perDoc)
});

/** Control: the same programs on Effect's default scheduler. */
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
		Effect.runPromise(readStress(limit, perDoc).pipe(Effect.provideService(DatabaseReader, ctx.db)))
});

/* Error identity. */

/** A `ConvexError` thrown by plain called code. */
async function plainLookup(userId: string): Promise<never> {
	throw createAdminError(ADMIN_ERROR_CODES.userNotFound, { userId });
}

export const passthroughQuery = effectInternalQuery({
	args: { userId: v.string() },
	returns: v.null(),
	handler: ({ userId }) => call(DatabaseReader, () => plainLookup(userId))
});

export class SpikeDefect extends Error {
	override readonly name = 'SpikeDefect';
}

export const defectQuery = effectInternalQuery({
	args: {},
	returns: v.null(),
	handler: () => Effect.die(new SpikeDefect('spike defect'))
});

/* Query clock. The probe counts every `Date.now()` call made while its body
 * runs (logs, spans, and an optional explicit read) and records what the
 * clock's ambient accessors returned. */

const clockProbeResult = v.object({
	dateNowCalls: v.number(),
	ambientCalls: v.number(),
	ambientNonZero: v.number(),
	explicitTime: v.union(v.number(), v.null())
});

const probeBody = (explicit: boolean) =>
	Effect.gen(function* () {
		yield* call(DatabaseReader, (db) => db.query('passkeyNudgeDismissals').first());
		yield* Effect.log('probe read done');
		yield* Effect.logDebug('probe debug line');
		yield* Effect.annotateCurrentSpan('probe', true);
		return explicit ? yield* Clock.currentTimeMillis : null;
	}).pipe(Effect.withSpan('effectSpike.clockProbe'));

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

export const clockProbeQuery = effectInternalQuery({
	args: { explicit: v.boolean(), live: v.boolean() },
	returns: clockProbeResult,
	handler: ({ explicit, live }) => clockProbe(explicit, live)
});

/* HTTP: an Effect program inside a native httpAction. */

class EchoRefused extends Data.TaggedError('EchoRefused')<{ readonly reason: string }> {}

export const echoHttp = httpAction((ctx, request) => {
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
	return runHttpAction(program, ctx);
});
