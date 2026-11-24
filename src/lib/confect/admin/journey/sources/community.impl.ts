import { FunctionImpl, GroupImpl } from '@confect/server';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import databaseSchema from '../../../_generated/schema';
import { readCommunity } from './community';
import community from './community.spec';

export default GroupImpl.make(databaseSchema, community).pipe(
	Layer.provide([
		FunctionImpl.make(databaseSchema, community, 'read', (request) =>
			Effect.gen(function* () {
				return yield* readCommunity(request);
			})
		)
	]),
	GroupImpl.finalize
);
