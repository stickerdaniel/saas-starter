/**
 * T0 spike: the SvelteKit server runtime for Effect. One `ManagedRuntime` per
 * isolate, built at module scope. Its layer and every request run on
 * `syncScheduler()`, the Effect recipe for Cloudflare Workers, so no shared
 * fiber resumes through a timer a finished request owned.
 *
 * Request-owned data arrives per call as `RequestContext`; it is never stored
 * in the runtime:
 *
 * ```ts
 * const exit = await runRequest(event, id, program);
 * ```
 */
import type { RequestEvent } from '@sveltejs/kit';
import * as Context from 'effect/Context';
import * as Effect from 'effect/Effect';
import type * as Exit from 'effect/Exit';
import * as Layer from 'effect/Layer';
import * as ManagedRuntime from 'effect/ManagedRuntime';
import * as Scheduler from 'effect/Scheduler';
import { syncScheduler } from '#lib/effect/scheduler.js';

/** The most ids `active` holds and entries `finished` and `mismatches` keep. */
export const LEDGER_LIMIT = 100;

/** Appends to a ledger list, dropping the oldest entry beyond LEDGER_LIMIT. */
export function record<T>(list: T[], entry: T): void {
	list.push(entry);
	if (list.length > LEDGER_LIMIT) list.splice(0, list.length - LEDGER_LIMIT);
}

/** Process-wide bookkeeping of request programs, for the T0 fixture. */
export interface Ledger {
	readonly active: Map<string, number>;
	readonly finished: Array<{ id: string; outcome: 'success' | 'failure' | 'interrupted' }>;
	readonly mismatches: Array<{ id: string; saw: string; step: number }>;
}
export class RequestLedger extends Context.Service<RequestLedger, Ledger>()(
	'server/RequestLedger'
) {}

export class RequestContext extends Context.Service<
	RequestContext,
	{ readonly id: string; readonly signal: AbortSignal }
>()('server/RequestContext') {}

const scheduler = syncScheduler();

export const serverRuntime = ManagedRuntime.make(
	Layer.sync(RequestLedger, () => ({ active: new Map(), finished: [], mismatches: [] })).pipe(
		Layer.provideMerge(Layer.succeed(Scheduler.Scheduler, scheduler))
	)
);

/**
 * Run one request's program on the shared runtime. The request's abort signal
 * interrupts it, so a cancelled request leaves no fiber behind.
 */
export function runRequest<A, E>(
	event: RequestEvent,
	id: string,
	program: Effect.Effect<A, E, RequestContext | RequestLedger>
): Promise<Exit.Exit<A, E>> {
	const signal = event.request.signal;
	return serverRuntime.runPromiseExit(
		Effect.provideService(program, RequestContext, { id, signal }),
		{ scheduler, signal }
	);
}
