import { FunctionImpl, GroupImpl } from '@confect/server';
import * as Layer from 'effect/Layer';
import databaseSchema from './_generated/schema';
import { getUsability } from './capabilities';
import capabilities from './capabilities.spec';

export default GroupImpl.make(databaseSchema, capabilities).pipe(
	Layer.provide([FunctionImpl.make(databaseSchema, capabilities, 'getUsability', getUsability)]),
	GroupImpl.finalize
);
