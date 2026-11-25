import { FunctionImpl, GroupImpl } from '@confect/server';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import { projectCapabilityUsability } from '../dev/features';
import databaseSchema from './_generated/schema';
import capabilities from './capabilities.spec';
import { getCapabilityConfigurations } from './env';

export default GroupImpl.make(databaseSchema, capabilities).pipe(
	Layer.provide([
		FunctionImpl.make(databaseSchema, capabilities, 'getUsability', () =>
			Effect.gen(function* () {
				return yield* Effect.sync(() => projectCapabilityUsability(getCapabilityConfigurations()));
			})
		)
	]),
	GroupImpl.finalize
);
