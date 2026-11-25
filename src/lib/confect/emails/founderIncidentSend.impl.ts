import { FunctionImpl, GroupImpl } from '@confect/server';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import databaseSchema from '../_generated/schema';
import { MutationCtx } from '../_generated/services';
import { queueFounderIncidentEmail, resolveFounderIncidentContact } from './founderIncidentCore';
import { founderIncidentRegistry } from './founderIncidentRegistry';
import founderIncidentSend from './founderIncidentSend.spec';

export default GroupImpl.make(databaseSchema, founderIncidentSend).pipe(
	Layer.provide([
		FunctionImpl.make(databaseSchema, founderIncidentSend, 'queueFounderIncidentEmail', (args) =>
			Effect.gen(function* () {
				const ctx = yield* MutationCtx;
				return yield* queueFounderIncidentEmail(
					ctx,
					founderIncidentRegistry,
					resolveFounderIncidentContact,
					args
				);
			})
		)
	]),
	GroupImpl.finalize
);
