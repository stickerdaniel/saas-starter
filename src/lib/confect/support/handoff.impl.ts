import { FunctionImpl, GroupImpl } from '@confect/server';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import type { MutationCtx as ConvexMutationCtx } from '../../convex/_generated/server';
import databaseSchema from '../_generated/schema';
import { MutationCtx } from '../_generated/services';
import handoff from './handoff.spec';
import { findSupportThread, handOffThread, settleUnanswered } from './handoffTurns';

const withMutation = <A>(run: (ctx: ConvexMutationCtx) => Promise<A>) =>
	MutationCtx.use((ctx) => Effect.promise(() => run(ctx)));

export default GroupImpl.make(databaseSchema, handoff).pipe(
	Layer.provide([
		FunctionImpl.make(databaseSchema, handoff, 'internalSetHandoff', ({ threadId, acknowledge }) =>
			Effect.gen(function* () {
				const supportThread = yield* withMutation((ctx) => findSupportThread(ctx, threadId));
				if (!supportThread) {
					console.log(`[internalSetHandoff] No supportThread found for: ${threadId}`);
					return null;
				}
				yield* withMutation((ctx) =>
					handOffThread(ctx, supportThread, { acknowledge: acknowledge === true })
				);
				return null;
			})
		),
		FunctionImpl.make(databaseSchema, handoff, 'settleUnansweredTurn', (turn) =>
			Effect.gen(function* () {
				yield* withMutation((ctx) => settleUnanswered(ctx, turn));
				return null;
			})
		)
	]),
	GroupImpl.finalize
);
