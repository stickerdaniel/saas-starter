import { FunctionImpl, GroupImpl } from '@confect/server';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import databaseSchema from '../../_generated/schema';
import { MutationCtx } from '../../_generated/services';
import { eraseJourneyPage, runErasurePage } from './erasure';
import erasure from './erasure.spec';

export default GroupImpl.make(databaseSchema, erasure).pipe(
	Layer.provide([
		FunctionImpl.make(databaseSchema, erasure, 'continueErasure', (run) =>
			Effect.gen(function* () {
				const ctx = yield* MutationCtx;
				yield* Effect.promise(() => runErasurePage(ctx, run));
				return null;
			})
		),
		FunctionImpl.make(databaseSchema, erasure, 'erasePage', (args) =>
			Effect.gen(function* () {
				return yield* eraseJourneyPage(args);
			})
		)
	]),
	GroupImpl.finalize
);
