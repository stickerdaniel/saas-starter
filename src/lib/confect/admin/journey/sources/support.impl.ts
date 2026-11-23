import { FunctionImpl, GroupImpl } from '@confect/server';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import databaseSchema from '../../../_generated/schema';
import { readSupport } from './support';
import support from './support.spec';

export default GroupImpl.make(databaseSchema, support).pipe(
	Layer.provide([
		FunctionImpl.make(databaseSchema, support, 'read', (request) =>
			Effect.gen(function* () {
				return yield* readSupport(request);
			})
		)
	]),
	GroupImpl.finalize
);
