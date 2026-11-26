import type { RequestEvent } from '@sveltejs/kit';
import * as Cause from 'effect/Cause';
import * as Context from 'effect/Context';
import * as Effect from 'effect/Effect';
import * as Exit from 'effect/Exit';
import * as Layer from 'effect/Layer';
import * as ManagedRuntime from 'effect/ManagedRuntime';
import { MixedScheduler } from 'effect/Scheduler';

export class ServerRequest extends Context.Service<ServerRequest, RequestEvent>()(
	'ServerRequest'
) {}

const scheduler = new MixedScheduler('sync');
const runtime = ManagedRuntime.make(Layer.empty);
runtime.runSync(Effect.void);

export async function runServerEffect<A, E>(effect: Effect.Effect<A, E>): Promise<A> {
	const exit = await runtime.runPromiseExit(effect, { scheduler });
	if (Exit.isSuccess(exit)) return exit.value;
	throw Cause.squash(exit.cause);
}

export const runRequestEffect = <A, E>(
	event: RequestEvent,
	effect: Effect.Effect<A, E, ServerRequest>
): Promise<A> => runServerEffect(Effect.provideService(effect, ServerRequest, event));
