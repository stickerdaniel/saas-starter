import { FunctionImpl, GroupImpl } from '@confect/server';
import * as Layer from 'effect/Layer';
import databaseSchema from '../../../_generated/schema';
import { read } from './support';
import support from './support.spec';

export default GroupImpl.make(databaseSchema, support).pipe(
	Layer.provide([FunctionImpl.make(databaseSchema, support, 'read', read)]),
	GroupImpl.finalize
);
