import { FunctionImpl, GroupImpl } from '@confect/server';
import * as Layer from 'effect/Layer';
import databaseSchema from '../_generated/schema';
import { insert } from './record';
import record from './record.spec';

export default GroupImpl.make(databaseSchema, record).pipe(
	Layer.provide([FunctionImpl.make(databaseSchema, record, 'insert', insert)]),
	GroupImpl.finalize
);
