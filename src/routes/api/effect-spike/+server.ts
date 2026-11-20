import { dev } from '$app/env';
import { EFFECT_SPIKE_FIXTURE } from '$app/env/private';
import * as Cause from 'effect/Cause';
import * as Effect from 'effect/Effect';
import * as Exit from 'effect/Exit';
import {
	LEDGER_LIMIT,
	RequestContext,
	RequestLedger,
	record,
	runRequest,
	serverRuntime
} from '#lib/server/effect-runtime.js';
import type { RequestHandler } from './$types';

// T0 spike fixture for the Worker runtime contract. `?id=<id>&ms=<n>` runs five
// steps, each a request-owned sleep plus 3,000 auto-yielding operations, and
// checks the request context at every step. `?ledger=1` returns what every
// program left behind: active ids, outcomes and context mismatches.
//
// The route answers 404 unless it runs under `vite dev` or EFFECT_SPIKE_FIXTURE=1
// (`EFFECT_SPIKE_FIXTURE=1 bunx varlock-wrangler dev`). The variable is unset by
// default, so a preview deployment does not expose the route.
export const prerender = false;

const json = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }
	});

const fixtureEnabled = dev || EFFECT_SPIKE_FIXTURE === '1';

const MAX_MS = 5_000;
const DEFAULT_MS = 500;

/** An integer in [0, 5000]; a missing or non-numeric value is 500. */
function parseMs(raw: string | null): number {
	const value = raw === null ? Number.NaN : Math.trunc(Number(raw));
	return Number.isNaN(value) ? DEFAULT_MS : Math.min(MAX_MS, Math.max(0, value));
}

/** At most 64 characters of `[A-Za-z0-9_-]`; anything else is dropped. */
function parseId(raw: string | null): string {
	return (raw ?? '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64) || 'anonymous';
}

const STEPS = 5;
const items = Array.from({ length: 3_000 }, (_, i) => i);

const steps = (ms: number) =>
	Effect.gen(function* () {
		const ledger = yield* RequestLedger;
		const { id } = yield* RequestContext;
		if (!ledger.active.has(id) && ledger.active.size >= LEDGER_LIMIT) {
			return { id, steps: 0, refused: 'ledger full' };
		}
		ledger.active.set(id, STEPS);
		return yield* Effect.gen(function* () {
			for (let step = 0; step < STEPS; step++) {
				yield* Effect.sleep(ms / STEPS);
				yield* Effect.forEach(items, (i) => Effect.succeed(i));
				const seen = (yield* RequestContext).id;
				if (seen !== id) record(ledger.mismatches, { id, saw: seen, step });
				ledger.active.set(id, STEPS - step - 1);
			}
			return { id, steps: STEPS };
		}).pipe(
			Effect.onExit((exit) =>
				Effect.sync(() => {
					ledger.active.delete(id);
					record(ledger.finished, {
						id,
						outcome: Exit.isSuccess(exit)
							? 'success'
							: Cause.hasInterruptsOnly(exit.cause)
								? 'interrupted'
								: 'failure'
					});
				})
			)
		);
	});

export const GET: RequestHandler = async (event) => {
	if (!fixtureEnabled) return new Response('Not Found', { status: 404 });
	const params = event.url.searchParams;
	if (params.has('ledger')) {
		const ledger = await serverRuntime.runPromise(RequestLedger.useSync((ledger) => ledger));
		return json({
			active: [...ledger.active.entries()],
			finished: ledger.finished,
			mismatches: ledger.mismatches
		});
	}
	const id = parseId(params.get('id'));
	const exit = await runRequest(event, id, steps(parseMs(params.get('ms'))));
	if (Exit.isSuccess(exit)) return json(exit.value);
	return json({ id, interrupted: Cause.hasInterruptsOnly(exit.cause) }, 500);
};
